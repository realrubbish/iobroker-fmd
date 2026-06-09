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
export declare class FmdAuth {
    private config;
    private httpClient;
    private cachedTokens?;
    constructor(config: FmdAuthConfig);
    /**
     * Get the server URL
     */
    getServerUrl(): string;
    /**
     * Check if tokens are cached and not expired
     */
    hasValidTokens(): boolean;
    /**
     * Get cached tokens
     */
    getTokens(): AuthTokens | undefined;
    /**
     * Main authentication flow:
     *   salt → client-side Argon2id → PasswordHash → access token → private key.
     *
     * Logs only lengths and the first 4 bytes of the salt (hex). Never
     * logs the password, the full salt, the full PHC string, the
     * access token, or the private key.
     */
    authenticate(): Promise<AuthTokens>;
    /**
     * Step 1: Retrieve the salt from the FMD server.
     *
     * POST /salt
     *   body: {"IDT": "<username>"}
     *   response: {"IDT": "<username>", "Data": "<salt URL-safe b64 no padding>"}
     */
    getSalt(): Promise<string>;
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
    deriveKey(saltUrlSafeB64: string): Promise<string>;
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
    login(passwordHash: string): Promise<string>;
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
    getPrivateKey(accessToken: string, password: string): Promise<string>;
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
    private decryptPrivateKey;
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
    refreshToken(): Promise<string>;
    /**
     * Clear cached tokens (force re-authentication)
     */
    clearTokens(): void;
    /**
     * Helper: Convert base64 (URL-safe or standard) to Uint8Array.
     * Auto-detects the input alphabet and tolerates missing padding.
     * Throws an Error with the offending input on failure.
     */
    private base64ToBytes;
    /**
     * Helper: Convert a Uint8Array to standard Base64 with no padding.
     * Matches `base64.StdEncoding.WithPadding(NoPadding)` on the
     * FMD server side, which is how the server decodes the
     * PasswordHash field.
     */
    private bytesToBase64;
    /**
     * Refresh-path helper: derive a PasswordHash from the private key.
     * Currently unused (refreshToken calls deriveKey via
     * deriveKeyFromPrivateKey below). Kept as a placeholder for future
     * use.
     */
    private deriveKeyFromPrivateKey;
}
//# sourceMappingURL=fmd-auth.d.ts.map