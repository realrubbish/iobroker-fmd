import axios, { AxiosInstance } from "axios";
import { createDecipheriv } from "crypto";
import { argon2id } from "hash-wasm";

/**
 * Authentication tokens received from FMD server
 */
export interface AuthTokens {
    accessToken: string;
    /**
     * The user's RSA private key, base64-encoded PKCS#8 DER. This is
     * the DECRYPTED form: the FMD server returns the key wrapped (salt
     * + AES-GCM ciphertext, all base64) and `getPrivateKey()` does the
     * Argon2id + AES-GCM unwrap before storing it here. Downstream
     * code (`FmdApi.signRequest` / `signRingPayload`) expects the
     * base64-DER body of the PKCS#8 PrivateKeyInfo, with no PEM
     * envelope.
     */
    privateKey: string;
    expiresAt?: number;
}

/**
 * Configuration for FMD authentication
 */
export interface FmdAuthConfig {
    serverUrl: string;
    username: string;
    password: string;
    log: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error: (msg: string) => void;
        debug: (msg: string) => void;
    };
}

/**
 * FMD Authentication module
 *
 * Implements the FMD server v0.14.0 auth protocol:
 *   1. POST /salt          with {IDT}                 → {Data: salt}
 *   2. Argon2id(password, salt) on the CLIENT         → PHC string
 *   3. POST /requestAccess with {IDT, PasswordHash}   → {Data: token}
 *   4. POST /key           with {IDT: token}          → {Data: PEM}
 *
 * Endpoint paths and payload shapes were verified against the FMD
 * server source at /Users/tschnurre/external-GIT/fmd-server tag v0.14.0
 * (matching the running container). The Argon2id parameters (memory
 * 64 MiB, iterations 3, parallelism 4, key length 32) match what the
 * FMD server expects to see in the PasswordHash field.
 *
 * Logging policy: only lengths and the first few bytes of salts are
 * ever logged. The password, the full salt, the full PHC string, the
 * access token, and the private key are NEVER logged at any level.
 */
export class FmdAuth {
    private config: FmdAuthConfig;
    private httpClient: AxiosInstance;
    private cachedTokens?: AuthTokens;

    constructor(config: FmdAuthConfig) {
        this.config = config;
        this.httpClient = axios.create({
            baseURL: config.serverUrl,
            timeout: 30000,
            headers: {
                "Content-Type": "application/json",
            },
        });
    }

    /**
     * Get the server URL
     */
    public getServerUrl(): string {
        return this.config.serverUrl;
    }

    /**
     * Check if tokens are cached and not expired
     */
    public hasValidTokens(): boolean {
        if (!this.cachedTokens) return false;
        if (this.cachedTokens.expiresAt && Date.now() > this.cachedTokens.expiresAt) {
            return false;
        }
        return true;
    }

    /**
     * Get cached tokens
     */
    public getTokens(): AuthTokens | undefined {
        return this.cachedTokens;
    }

    /**
     * Main authentication flow:
     *   salt → client-side Argon2id → PasswordHash → access token → private key.
     *
     * Logs only lengths and the first 4 bytes of the salt (hex). Never
     * logs the password, the full salt, the full PHC string, the
     * access token, or the private key.
     */
    public async authenticate(): Promise<AuthTokens> {
        this.config.log.info("Starting FMD authentication flow...");

        try {
            // Step 1: Get salt from server.
            const salt = await this.getSalt();
            this.config.log.debug(`Received salt (${salt.length} bytes URL-safe Base64)`);

            // Step 2: Derive PasswordHash on the client.
            // Argon2id with FMD-mandated parameters, output in PHC format.
            const passwordHash = await this.deriveKey(salt);
            this.config.log.debug(`Derived PasswordHash (${passwordHash.length} chars)`);

            // Step 3: Exchange PasswordHash for access token.
            const accessToken = await this.login(passwordHash);
            this.config.log.debug(`Received access token (${accessToken.length} chars)`);

            // Step 4: Retrieve the private key (wrapped) and unwrap
            // it with the user's password (see getPrivateKey jsdoc for
            // the wrap-format details). What we store is the
            // base64-DER PKCS#8 body, ready for signRingPayload.
            const privateKey = await this.getPrivateKey(accessToken, this.config.password);
            this.config.log.debug(`Decrypted private key (${privateKey.length} chars b64-DER)`);

            // Cache for the session. The 1-hour expiry is a conservative
            // default; the FMD server caps at 1 week (see
            // MAX_TOKEN_VALID_SECS in user/access.go).
            this.cachedTokens = {
                accessToken,
                privateKey,
                expiresAt: Date.now() + 3600000,
            };

            this.config.log.info("FMD authentication successful");
            return this.cachedTokens;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`FMD authentication failed: ${errorMsg}`);
            throw err;
        }
    }

    /**
     * Step 1: Retrieve the salt from the FMD server.
     *
     * POST /salt
     *   body: {"IDT": "<username>"}
     *   response: {"IDT": "<username>", "Data": "<salt URL-safe b64 no padding>"}
     */
    public async getSalt(): Promise<string> {
        try {
            const response = await this.httpClient.post<{ IDT: string; Data: string }>(
                "/salt",
                { IDT: this.config.username },
            );
            if (!response.data?.Data) {
                throw new Error("Salt response missing Data field");
            }
            return response.data.Data;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to get salt: ${errorMsg}`);
            throw new Error(`Failed to get salt: ${errorMsg}`);
        }
    }

    /**
     * Step 2: Run Argon2id on the client with the FMD Android client's
     * parameters, then return the FULL PHC-encoded string (not just
     * the hash portion).
     *
     * Parameters (verified against the FMD Android source at
     * /Users/tschnurre/external-GIT/fmd-android CypherUtils.java):
     *   - algorithm:    Argon2id (ARGON2_VERSION_13)
     *   - memory:       128 MiB (131072 KiB) — NOT 64 MiB as I
     *                   originally assumed from the FMD server source
     *   - iterations:   1 — NOT 3 as I originally assumed
     *   - parallelism:  4
     *   - key length:   32 bytes
     *   - salt length:  16 bytes (URL-safe Base64 from the server)
     *   - output:       PHC-encoded string (the entire
     *                   `$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`
     *                   string, ~92 chars). The FMD server then
     *                   SHA-512s the prefix
     *                   "context:serverSidePasswordHash" +
     *                   the PHC-string to compare with the stored
     *                   value (see FMD server user/password.go
     *                   `hashPasswordForLogin`).
     *
     * NOTE: the password is mixed with a context string BEFORE
     * hashing. The FMD Android client uses "context:loginAuthentication"
     * as the prefix (CypherUtils.CONTEXT_STRING_LOGIN). The server's
     * password.go uses "context:serverSidePasswordHash" as a SEPARATE
     * context for the server-side SHA-512 step. The CLIENT does the
     * Argon2 with the login context, the SERVER does the SHA-512 with
     * the server-side context.
     */
    public async deriveKey(saltUrlSafeB64: string): Promise<string> {
        try {
            // URL-safe Base64 (no padding) -> raw 16 bytes
            const saltBytes = this.base64ToBytes(saltUrlSafeB64);
            if (saltBytes.length !== 16) {
                throw new Error(
                    `Salt length is ${saltBytes.length} bytes, expected 16 (FMD server returns 16-byte salts URL-safe encoded as 22 chars)`,
                );
            }

            // The FMD Android client uses the context string
            // "context:loginAuthentication" as a salt-like prefix
            // BEFORE Argon2id hashing. Without this, the server-side
            // hash will not match.
            const passwordWithContext = "context:loginAuthentication" + this.config.password;

            // Run Argon2id with the FMD Android client parameters
            // (memory 128 MiB = 131072 KiB, iterations 1, parallelism 4,
            // hash length 32, version 19). We use hash-wasm here
            // because the npm `argon2` package enforces timeCost >= 2,
            // while the FMD spec requires timeCost = 1. The output
            // is the full PHC-encoded string which we send as-is to
            // the server.
            const phcString = await argon2id({
                password: passwordWithContext,
                salt: Buffer.from(saltBytes),
                parallelism: 4,
                iterations: 1,        // FMD Android client
                memorySize: 131072,   // 128 MiB in KiB
                hashLength: 32,
                outputType: "encoded",
            });

            return phcString;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Key derivation failed: ${errorMsg}`);
            throw new Error(`Key derivation failed: ${errorMsg}`);
        }
    }

    /**
     * Step 3: Exchange the PasswordHash for an access token.
     *
     * PUT /requestAccess  (NOT POST! — the FMD Android client uses
     * PUT, see FmdServerApiV1Repository.kt line 198. The Go server's
     * http.HandleFunc accepts any method, but the Android client
     * always sends PUT, so we do too for behavioural parity.)
     *
     *   body: {"IDT": "<username>", "Data": "<phc-string>", "SessionDurationSeconds": 86400}
     *   response: {"IDT": "<username>", "Data": "<access-token>"}
     *
     * IMPORTANT: the field name for the password hash is "Data", not
     * "PasswordHash". The Go server's requestAccess decodes
     * `data.PasswordHash` from the JSON, but the Android client sends
     * it under "Data" — the server-side code uses a generic
     * DataPackage{IDT, Data} and the Android client populates Data
     * with the PHC string. We follow the Android client.
     *
     * 86400 seconds (1 day) is a reasonable default. The FMD server
     * caps session length at 1 week (MAX_TOKEN_VALID_SECS in
     * user/access.go).
     */
    public async login(passwordHash: string): Promise<string> {
        try {
            const response = await this.httpClient.put<{ IDT: string; Data: string }>(
                "/requestAccess",
                {
                    IDT: this.config.username,
                    Data: passwordHash,
                    SessionDurationSeconds: 86400,
                },
            );
            if (!response.data?.Data) {
                throw new Error("Login response missing Data field");
            }
            return response.data.Data;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Login failed: ${errorMsg}`);
            throw new Error(`Login failed: ${errorMsg}`);
        }
    }

    /**
     * Step 4: Retrieve the private key (wrapped) using the access
     * token, then unwrap it with the user's password.
     *
     * POST /key
     *   body: {"IDT": "<accessToken>"}
     *   response: {"IDT": "<accessToken>", "Data": "<wrapped-key-base64>"}
     *
     * The server-returned `Data` is NOT a raw PEM and NOT a raw
     * PKCS#8 DER. It is the FMD Android client's wrap format
     * (`CypherUtils.encryptPrivateKeyWithPassword`, verified against
     * the upstream source at
     * `/Users/tschnurre/external-GIT/fmd-android/.../utils/CypherUtils.java`,
     * lines 230-257):
     *
     *   wrapped = base64( salt || IV || ct || tag )
     *     where
     *       salt = 16 random bytes (Argon2 salt)
     *       IV   = 12 random bytes (AES-GCM nonce)
     *       ct   = AES-256-GCM ciphertext of the PEM-encoded PKCS#8
     *       tag  = 16-byte GCM authentication tag (appended by Java's
     *              Cipher when AES/GCM/NoPadding is used)
     *
     *   AES key = Argon2id(
     *     password = "context:asymmetricKeyWrap" + userPassword,
     *     salt     = salt,
     *     t = 1, p = 4, m = 131072 KiB, hashLen = 32
     *   )
     *
     * The decrypted plaintext is the PEM
     *   -----BEGIN PRIVATE KEY-----
     *   <base64 PKCS#8 PrivateKeyInfo>
     *   -----END PRIVATE KEY-----
     *
     * We strip the PEM envelope and return the inner base64 string —
     * that is the format `FmdApi.signRequest` / `signRingPayload`
     * expects on the way in.
     */
    public async getPrivateKey(accessToken: string, password: string): Promise<string> {
        try {
            const response = await this.httpClient.post<{ IDT: string; Data: string }>(
                "/key",
                { IDT: accessToken },
            );
            if (!response.data?.Data) {
                throw new Error("Private key response missing Data field");
            }
            const wrappedKey = response.data.Data;
            const pem = await this.decryptPrivateKey(wrappedKey, password);
            // Strip the PEM envelope; keep only the base64-DER body so
            // signRingPayload can feed it straight into
            // forge.util.decode64 → forge.asn1.fromDer.
            const b64Body = pem
                .replace(/-----BEGIN PRIVATE KEY-----/, "")
                .replace(/-----END PRIVATE KEY-----/, "")
                .replace(/\s/g, "");
            if (b64Body.length === 0) {
                throw new Error("Decrypted PEM is empty (after envelope strip)");
            }
            return b64Body;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to get private key: ${errorMsg}`);
            throw new Error(`Failed to get private key: ${errorMsg}`);
        }
    }

    /**
     * Decrypt the FMD-server-returned wrapped private key blob.
     *
     * The wrap format is described in detail on `getPrivateKey`. This
     * helper does the Argon2id + AES-256-GCM unwrap and returns the
     * PEM string (envelope included; the caller strips it).
     *
     * Constants match the FMD Android client's `CypherUtils` exactly:
     *   ARGON2_SALT_LENGTH = 16, AES_GCM_IV_SIZE_BYTES = 12,
     *   AES_GCM_TAG_SIZE_BYTES = 16, AES_GCM_KEY_SIZE_BYTES = 32,
     *   ARGON2 params: t=1, p=4, m=131072 KiB, hashLen=32,
     *   context = "context:asymmetricKeyWrap".
     */
    private async decryptPrivateKey(wrappedB64: string, password: string): Promise<string> {
        const ARGON2_SALT_LENGTH = 16;
        const ARGON2_HASH_LENGTH = 32;
        const AES_GCM_IV_SIZE_BYTES = 12;
        const AES_GCM_TAG_SIZE_BYTES = 16;
        const CONTEXT_ASYM_KEY_WRAP = "context:asymmetricKeyWrap";

        // base64 → bytes. The server uses standard (not URL-safe) base64
        // and adds padding; our base64ToBytes tolerates both alphabets
        // and missing padding, so it works here too.
        const concatBytes = this.base64ToBytes(wrappedB64);
        const minLen = ARGON2_SALT_LENGTH + AES_GCM_IV_SIZE_BYTES + AES_GCM_TAG_SIZE_BYTES;
        if (concatBytes.length < minLen) {
            throw new Error(
                `Wrapped private key too short: ${concatBytes.length} bytes (need at least ${minLen})`,
            );
        }

        // Split: salt | ciphertext-with-iv-and-tag
        const saltBytes = concatBytes.subarray(0, ARGON2_SALT_LENGTH);
        const aesBlob = concatBytes.subarray(ARGON2_SALT_LENGTH);

        // Derive AES key with Argon2id (different context than the
        // login flow's "context:loginAuthentication" — see the
        // CypherUtils comment about "hacky key separation"). hash-wasm's
        // outputType "binary" gives us the raw 32 hash bytes (no PHC
        // wrapper) which is what AES-256-GCM wants.
        const aesKey = (await argon2id({
            password: CONTEXT_ASYM_KEY_WRAP + password,
            salt: saltBytes,
            parallelism: 4,
            iterations: 1,
            memorySize: 131072,
            hashLength: ARGON2_HASH_LENGTH,
            outputType: "binary",
        })) as Uint8Array;

        // Split the AES blob: IV (first 12) | ciphertext | tag (last 16).
        // Node's createDecipheriv wants the IV at construction, the
        // ciphertext via update(), and the tag via setAuthTag() —
        // Java's Cipher does it all in one doFinal() with the tag
        // glued onto the ciphertext, which is the form we receive.
        const ivBytes = aesBlob.subarray(0, AES_GCM_IV_SIZE_BYTES);
        const ctAndTag = aesBlob.subarray(AES_GCM_IV_SIZE_BYTES);
        const ctOnly = ctAndTag.subarray(0, ctAndTag.length - AES_GCM_TAG_SIZE_BYTES);
        const tag = ctAndTag.subarray(ctAndTag.length - AES_GCM_TAG_SIZE_BYTES);

        try {
            const decipher = createDecipheriv("aes-256-gcm", Buffer.from(aesKey), Buffer.from(ivBytes));
            decipher.setAuthTag(Buffer.from(tag));
            const plaintext = Buffer.concat([decipher.update(Buffer.from(ctOnly)), decipher.final()]);
            return plaintext.toString("utf8");
        } catch (err) {
            // GCM auth failure throws "Unsupported state or unable to
            // authenticate data" — usually means the password is
            // wrong. Surface it cleanly; the adapter's lastError will
            // get a meaningful message instead of a stack trace.
            const errorMsg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `AES-GCM decrypt failed (likely wrong password or corrupted wrapped key): ${errorMsg}`,
            );
        }
    }

    /**
     * Refresh access token using private key.
     *
     * The FMD server's /requestAccess endpoint is the same shape as
     * login, but the IDT is the existing access token (not the
     * username), and the PasswordHash is derived from the private key
     * (the server's RequestAccess re-uses the password hash check on
     * the stored HashedPassword). The server may return a new token
     * with a bumped expiry.
     *
     * NOTE: this is currently not exercised by authenticate(); the
     * 1-hour cache expiry triggers a full re-auth instead. Kept
     * available for future use.
     */
    public async refreshToken(): Promise<string> {
        if (!this.cachedTokens?.privateKey) {
            throw new Error("No private key available for token refresh");
        }

        try {
            // We do not have a "refresh" endpoint in the FMD server; we
            // re-run the full access request with the existing token
            // as IDT and a hash derived from the private key as
            // PasswordHash. The server re-validates against the
            // stored HashedPassword.
            const passwordHash = await this.deriveKeyFromPrivateKey(this.cachedTokens.privateKey);
            const response = await this.httpClient.post<{ IDT: string; Data: string }>(
                "/requestAccess",
                {
                    IDT: this.cachedTokens.accessToken,
                    PasswordHash: passwordHash,
                    SessionDurationSeconds: 86400,
                },
            );

            this.cachedTokens.accessToken = response.data.Data;
            this.cachedTokens.expiresAt = Date.now() + 3600000;

            this.config.log.info("Token refreshed successfully");
            return this.cachedTokens.accessToken;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Token refresh failed: ${errorMsg}`);
            throw new Error(`Token refresh failed: ${errorMsg}`);
        }
    }

    /**
     * Clear cached tokens (force re-authentication)
     */
    public clearTokens(): void {
        this.cachedTokens = undefined;
        this.config.log.debug("Cached tokens cleared");
    }

    /**
     * Helper: Convert base64 (URL-safe or standard) to Uint8Array.
     * Auto-detects the input alphabet and tolerates missing padding.
     * Throws an Error with the offending input on failure.
     */
    private base64ToBytes(base64: string): Uint8Array {
        if (typeof base64 !== "string" || base64.length === 0) {
            throw new Error("base64ToBytes: input is not a non-empty string");
        }
        // Replace URL-safe alphabet with standard so atob can handle it.
        // Also strip whitespace defensively (some servers pad with newlines).
        const normalized = base64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
        // atob requires padding; if the input has no padding, add it.
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        let binaryString: string;
        try {
            binaryString = atob(padded);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `base64ToBytes: cannot decode input (${base64.length} chars, first=${base64.slice(0, 16)}): ${msg}`,
            );
        }
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Helper: Convert a Uint8Array to standard Base64 with no padding.
     * Matches `base64.StdEncoding.WithPadding(NoPadding)` on the
     * FMD server side, which is how the server decodes the
     * PasswordHash field.
     */
    private bytesToBase64(bytes: Uint8Array): string {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/=+$/, "");
    }

    /**
     * Refresh-path helper: derive a PasswordHash from the private key.
     * Currently unused (refreshToken calls deriveKey via
     * deriveKeyFromPrivateKey below). Kept as a placeholder for future
     * use.
     */
    private async deriveKeyFromPrivateKey(privateKey: string): Promise<string> {
        // The FMD server uses the private key as the "password" for
        // refresh requests. We Argon2id-hash it with a fixed empty
        // salt (this is a transport encoding, not security); the
        // server verifies by SHA-512-ing the result with the same
        // "context:serverSidePasswordHash" prefix.
        const emptySalt = new Uint8Array(16); // 16 zero bytes
        const phcString = await argon2id({
            password: privateKey,
            salt: emptySalt,
            parallelism: 4,
            iterations: 1,
            memorySize: 131072,
            hashLength: 32,
            outputType: "encoded",
        });
        return phcString;
    }
}
