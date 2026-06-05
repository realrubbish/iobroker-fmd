import axios, { AxiosInstance } from "axios";
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
export class FmdApi {
    private config: FmdApiConfig;
    private httpClient: AxiosInstance;

    constructor(config: FmdApiConfig) {
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
     * List all devices from FMD server
     */
    public async listDevices(): Promise<FmdDevice[]> {
        try {
            const response = await this.httpClient.get<{ devices: FmdDevice[] }>("/api/v1/devices", {
                headers: this.buildAuthHeaders(),
            });
            return response.data.devices || [];
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to list devices: ${errorMsg}`);
            throw new Error(`Failed to list devices: ${errorMsg}`);
        }
    }

    /**
     * Send ring command to a device
     * @param deviceId The device ID to ring
     */
    public async sendRingCommand(deviceId: string): Promise<void> {
        const command = `ring:${deviceId}`;
        const unixTime = Date.now();
        const signature = await this.signRequest(command, unixTime);

        try {
            await this.httpClient.post(
                "/api/v1/command",
                {
                    Data: command,
                    UnixTime: unixTime,
                },
                {
                    headers: {
                        IDT: this.config.authTokens.accessToken,
                        CmdSig: signature,
                    },
                }
            );
            this.config.log.info(`Ring command sent to device: ${deviceId}`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to send ring command: ${errorMsg}`);
            throw new Error(`Failed to send ring command: ${errorMsg}`);
        }
    }

    /**
     * Build authentication headers for API requests
     */
    private buildAuthHeaders(): Record<string, string> {
        return {
            IDT: this.config.authTokens.accessToken,
        };
    }

    /**
     * Sign a request using RSA-PSS-SHA256
     * Format: Data:UnixTime concatenated, then signed
     */
    private async signRequest(data: string, unixTime: number): Promise<string> {
        try {
            const privateKeyBytes = this.base64ToBytes(this.config.authTokens.privateKey);

            // Import the private key
            const key = await crypto.subtle.importKey(
                "pkcs8",
                privateKeyBytes,
                {
                    name: "RSA-PSS",
                    hash: "SHA-256",
                },
                false,
                ["sign"]
            );

            // Create the data to sign: "Data:UnixTime"
            const dataToSign = `${data}:${unixTime}`;
            const encoder = new TextEncoder();
            const dataBytes = encoder.encode(dataToSign);

            // Sign using RSA-PSS-SHA256
            const signature = await crypto.subtle.sign(
                {
                    name: "RSA-PSS",
                    saltLength: 32,
                },
                key,
                dataBytes
            );

            return this.bytesToBase64(new Uint8Array(signature));
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to sign request: ${errorMsg}`);
            throw new Error(`Failed to sign request: ${errorMsg}`);
        }
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
