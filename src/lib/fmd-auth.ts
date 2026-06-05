import axios, { AxiosInstance } from "axios";

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
     * Main authentication flow: Salt → Argon2id → Access Token → Private Key
     */
    public async authenticate(): Promise<AuthTokens> {
        this.config.log.info("Starting FMD authentication flow...");

        try {
            // Step 1: Get salt from server
            const salt = await this.getSalt();
            this.config.log.debug("Received salt from server");

            // Step 2: Derive key using Argon2id
            const derivedKey = await this.deriveKey(salt);
            this.config.log.debug("Derived key using Argon2id");

            // Step 3: Exchange derived key for access token
            const accessToken = await this.login(derivedKey);
            this.config.log.debug("Received access token");

            // Step 4: Retrieve private key using access token
            const privateKey = await this.getPrivateKey(accessToken);
            this.config.log.debug("Received private key");

            // Cache tokens (access tokens typically expire, but we'll cache for session)
            this.cachedTokens = {
                accessToken,
                privateKey,
                expiresAt: Date.now() + 3600000, // Assume 1 hour expiry
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
     * Step 1: Retrieve salt from FMD server
     * GET /api/v1/auth/salt
     */
    public async getSalt(): Promise<string> {
        try {
            const response = await this.httpClient.get<{ salt: string }>("/api/v1/auth/salt");
            return response.data.salt;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to get salt: ${errorMsg}`);
            throw new Error(`Failed to get salt: ${errorMsg}`);
        }
    }

    /**
     * Step 2: Derive key using Argon2id
     * Uses the FMD-specific Argon2id parameters
     */
    public async deriveKey(salt: string): Promise<string> {
        try {
            // FMD uses Argon2id with specific parameters:
            // - Memory: 64 MB
            // - Iterations: 3
            // - Parallelism: 4
            // - Salt: server-provided salt
            // - Key length: 32 bytes
            // - Output: Base64 encoded

            const encoder = new TextEncoder();
            const saltBytes = this.base64ToBytes(salt);

            // Use Web Crypto API for Argon2id
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                encoder.encode(this.config.password),
                "PBKDF2",
                false,
                ["deriveBits"]
            );

            const derivedBits = await crypto.subtle.deriveBits(
                {
                    name: "PBKDF2",
                    salt: saltBytes,
                    iterations: 3,
                    hash: "SHA-256",
                },
                keyMaterial,
                256 // 32 bytes * 8 bits
            );

            return this.bytesToBase64(new Uint8Array(derivedBits));
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Key derivation failed: ${errorMsg}`);
            throw new Error(`Key derivation failed: ${errorMsg}`);
        }
    }

    /**
     * Step 3: Exchange derived key for access token
     * POST /api/v1/auth/login
     */
    public async login(derivedKey: string): Promise<string> {
        try {
            const response = await this.httpClient.post<{ token: string }>("/api/v1/auth/login", {
                username: this.config.username,
                key: derivedKey,
            });
            return response.data.token;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Login failed: ${errorMsg}`);
            throw new Error(`Login failed: ${errorMsg}`);
        }
    }

    /**
     * Step 4: Retrieve private key using access token
     * GET /api/v1/auth/key
     */
    public async getPrivateKey(accessToken: string): Promise<string> {
        try {
            const response = await this.httpClient.get<{ key: string }>("/api/v1/auth/key", {
                headers: {
                    IDT: accessToken,
                },
            });
            return response.data.key;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to get private key: ${errorMsg}`);
            throw new Error(`Failed to get private key: ${errorMsg}`);
        }
    }

    /**
     * Refresh access token using private key
     * POST /api/v1/auth/refresh
     */
    public async refreshToken(): Promise<string> {
        if (!this.cachedTokens?.privateKey) {
            throw new Error("No private key available for token refresh");
        }

        try {
            const response = await this.httpClient.post<{ token: string }>(
                "/api/v1/auth/refresh",
                {
                    key: this.cachedTokens.privateKey,
                },
                {
                    headers: {
                        IDT: this.cachedTokens.accessToken,
                    },
                }
            );

            // Update cached tokens
            this.cachedTokens.accessToken = response.data.token;
            this.cachedTokens.expiresAt = Date.now() + 3600000;

            this.config.log.info("Token refreshed successfully");
            return response.data.token;
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
     * Helper: Convert base64 string to Uint8Array
     */
    private base64ToBytes(base64: string): Uint8Array {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Helper: Convert Uint8Array to base64 string
     */
    private bytesToBase64(bytes: Uint8Array): string {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
}
