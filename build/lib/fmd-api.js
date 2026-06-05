"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FmdApi = void 0;
const axios_1 = __importDefault(require("axios"));
/**
 * FMD API module
 * Handles signed API requests to FMD server
 */
class FmdApi {
    config;
    httpClient;
    constructor(config) {
        this.config = config;
        this.httpClient = axios_1.default.create({
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
    async listDevices() {
        try {
            const response = await this.httpClient.get("/api/v1/devices", {
                headers: this.buildAuthHeaders(),
            });
            return response.data.devices || [];
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to list devices: ${errorMsg}`);
            throw new Error(`Failed to list devices: ${errorMsg}`);
        }
    }
    /**
     * Send ring command to a device
     * @param deviceId The device ID to ring
     */
    async sendRingCommand(deviceId) {
        const command = `ring:${deviceId}`;
        const unixTime = Date.now();
        const signature = await this.signRequest(command, unixTime);
        try {
            await this.httpClient.post("/api/v1/command", {
                Data: command,
                UnixTime: unixTime,
            }, {
                headers: {
                    IDT: this.config.authTokens.accessToken,
                    CmdSig: signature,
                },
            });
            this.config.log.info(`Ring command sent to device: ${deviceId}`);
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to send ring command: ${errorMsg}`);
            throw new Error(`Failed to send ring command: ${errorMsg}`);
        }
    }
    /**
     * Build authentication headers for API requests
     */
    buildAuthHeaders() {
        return {
            IDT: this.config.authTokens.accessToken,
        };
    }
    /**
     * Sign a request using RSA-PSS-SHA256
     * Format: Data:UnixTime concatenated, then signed
     */
    async signRequest(data, unixTime) {
        try {
            const privateKeyBytes = this.base64ToBytes(this.config.authTokens.privateKey);
            // Import the private key
            const key = await crypto.subtle.importKey("pkcs8", privateKeyBytes, {
                name: "RSA-PSS",
                hash: "SHA-256",
            }, false, ["sign"]);
            // Create the data to sign: "Data:UnixTime"
            const dataToSign = `${data}:${unixTime}`;
            const encoder = new TextEncoder();
            const dataBytes = encoder.encode(dataToSign);
            // Sign using RSA-PSS-SHA256
            const signature = await crypto.subtle.sign({
                name: "RSA-PSS",
                saltLength: 32,
            }, key, dataBytes);
            return this.bytesToBase64(new Uint8Array(signature));
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to sign request: ${errorMsg}`);
            throw new Error(`Failed to sign request: ${errorMsg}`);
        }
    }
    /**
     * Helper: Convert base64 string to Uint8Array
     */
    base64ToBytes(base64) {
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
    bytesToBase64(bytes) {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
}
exports.FmdApi = FmdApi;
//# sourceMappingURL=fmd-api.js.map