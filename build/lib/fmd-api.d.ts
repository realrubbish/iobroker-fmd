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
 * Sign a ring-command payload with a base64-encoded PKCS#8 private
 * key, using `node-forge` with all four RSA-PSS parameters pinned
 * explicitly.
 *
 * The PSS profile is:
 *   - hash:       SHA-256
 *   - MGF1 hash:  SHA-256
 *   - saltLength: 32
 *   - trailer:    1 (modern PSS, the only trailer PKCS#1 v2.1 defines)
 *
 * This matches the FMD Android verifier's
 * `PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, 32, 1)`
 * at `CypherUtils.java:325-326`.
 *
 * Exported as a module-level function (not a private method) so the
 * `scripts/ring-smoke.mjs --verify` self-test can import the same
 * code path the adapter uses. Drift between "what the adapter signs"
 * and "what the smoke script signs" is the failure mode the
 * previous change's smoke script could not catch.
 */
export declare function signRingPayload(privateKeyBase64: string, payload: string): string;
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
     * @param deviceId The device ID to ring (informational only; the
     *   FMD server routes by access-token-owner, not by device-id, so
     *   the command is always delivered to the user this `FmdApi`
     *   instance authenticated as. The `deviceId` is logged for
     *   observability and kept in the public signature so the caller
     *   does not have to change.)
     */
    sendRingCommand(deviceId: string): Promise<void>;
    /**
     * Build authentication headers for API requests
     */
    private buildAuthHeaders;
    /**
     * Sign a request using RSA-PSS-SHA256.
     *
     * The caller (`sendRingCommand`) is responsible for building the
     * exact string to sign. Per the FMD server
     * (`backend/apiv1.go:44`, `CmdSig string // base64-encoded
     * signature over "UnixTime:Data"`) and the FMD Android client
     * (`FmdServerApiV1Repository.kt:594`,
     * `CypherUtils.verifySig(publicKeyPem, "$time:$command", sig)`),
     * the signed string is `${unixTime}:${data}`. This helper is a
     * pure bytes-to-signature transformer; the format string lives at
     * the call site.
     *
     * The PSS profile and private-key format are documented on
     * `signRingPayload` (the module-level function that does the
     * actual work; this method is a thin async wrapper for the
     * call-site interface).
     */
    private signRequest;
}
export {};
//# sourceMappingURL=fmd-api.d.ts.map