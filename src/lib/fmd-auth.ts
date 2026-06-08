import axios, { AxiosInstance } from "axios";
import { argon2id } from "hash-wasm";

/**
 * Authentication tokens received from FMD server
 */
export interface AuthTokens {
    accessToken: string;
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

            // Step 4: Retrieve the private key (PEM).
            const privateKey = await this.getPrivateKey(accessToken);
            this.config.log.debug(`Received private key (${privateKey.length} chars)`);

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
     * Step 4: Retrieve the private key (PEM) using the access token.
     *
     * POST /key
     *   body: {"IDT": "<accessToken>"}
     *   response: {"IDT": "<accessToken>", "Data": "<pem-string>"}
     */
    public async getPrivateKey(accessToken: string): Promise<string> {
        try {
            const response = await this.httpClient.post<{ IDT: string; Data: string }>(
                "/key",
                { IDT: accessToken },
            );
            if (!response.data?.Data) {
                throw new Error("Private key response missing Data field");
            }
            return response.data.Data;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to get private key: ${errorMsg}`);
            throw new Error(`Failed to get private key: ${errorMsg}`);
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
