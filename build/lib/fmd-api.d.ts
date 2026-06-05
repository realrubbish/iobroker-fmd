import { AuthTokens } from "./fmd-auth";
/**
 * FMD Device information
 */
export interface FmdDevice {
    id: string;
    name: string;
    type: string;
    lastRing?: number;
}
/**
 * Logger interface
 */
interface Logger {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
}
/**
 * Configuration for FMD API
 */
export interface FmdApiConfig {
    serverUrl: string;
    authTokens: AuthTokens;
    log: Logger;
}
/**
 * FMD API module
 * Handles signed API requests to FMD server
 */
export declare class FmdApi {
    private config;
    private httpClient;
    constructor(config: FmdApiConfig);
    /**
     * List all devices from FMD server
     */
    listDevices(): Promise<FmdDevice[]>;
    /**
     * Send ring command to a device
     * @param deviceId The device ID to ring
     */
    sendRingCommand(deviceId: string): Promise<void>;
    /**
     * Build authentication headers for API requests
     */
    private buildAuthHeaders;
    /**
     * Sign a request using RSA-PSS-SHA256
     * Format: Data:UnixTime concatenated, then signed
     */
    private signRequest;
    /**
     * Helper: Convert base64 string to Uint8Array
     */
    private base64ToBytes;
    /**
     * Helper: Convert Uint8Array to base64 string
     */
    private bytesToBase64;
}
export {};
//# sourceMappingURL=fmd-api.d.ts.map