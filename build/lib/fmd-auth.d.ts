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
 * Implements multi-step auth: Salt → Argon2id → Access Token → Private Key
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
     * Main authentication flow: Salt → Argon2id → Access Token → Private Key
     */
    authenticate(): Promise<AuthTokens>;
    /**
     * Step 1: Retrieve salt from FMD server
     * GET /api/v1/auth/salt
     */
    getSalt(): Promise<string>;
    /**
     * Step 2: Derive key using Argon2id
     * Uses the FMD-specific Argon2id parameters
     */
    deriveKey(salt: string): Promise<string>;
    /**
     * Step 3: Exchange derived key for access token
     * POST /api/v1/auth/login
     */
    login(derivedKey: string): Promise<string>;
    /**
     * Step 4: Retrieve private key using access token
     * GET /api/v1/auth/key
     */
    getPrivateKey(accessToken: string): Promise<string>;
    /**
     * Refresh access token using private key
     * POST /api/v1/auth/refresh
     */
    refreshToken(): Promise<string>;
    /**
     * Clear cached tokens (force re-authentication)
     */
    clearTokens(): void;
    /**
     * Helper: Convert base64 string to Uint8Array
     */
    private base64ToBytes;
    /**
     * Helper: Convert Uint8Array to base64 string
     */
    private bytesToBase64;
}
//# sourceMappingURL=fmd-auth.d.ts.map