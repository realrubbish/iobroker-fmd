import axios, { AxiosInstance } from "axios";
import forge from "node-forge";
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
export function signRingPayload(privateKeyBase64: string, payload: string): string {
    // Spike (1.1 in openspec/changes/fix-ring-signing-followup/tasks.md)
    // confirmed this round-trip:
    //   base64 (PKCS#8 DER, the storage format FMD returns from
    //   `AccessKeyData`) → forge buffer → ASN.1 → RSAPrivateKey.
    //   pki.privateKeyFromAsn1 accepts both PKCS#8 PrivateKeyInfo and
    //   PKCS#1 RSAPrivateKey, so a future FMD server that returns
    //   PKCS#1 would not require a code change here.
    const derBytes = forge.util.createBuffer(forge.util.decode64(privateKeyBase64));
    const asn1 = forge.asn1.fromDer(derBytes);
    const privateKey = forge.pki.privateKeyFromAsn1(asn1);

    // forge.pss.create is **positional**: (md, mgf, saltLength).
    // The second argument must be a forge mgf instance
    // (forge.mgf.mgf1.create(md) — note the method name `mgf1` is
    // for the MGF1 algorithm, the option key is `mgf`); passing a
    // bare MessageDigest is the most common bug here. The trailer
    // field is implicitly 1 (the only trailer PKCS#1 v2.1 defines).
    //
    // The four PSS parameters pinned here — hash=SHA-256,
    // MGF1 hash=SHA-256, saltLength=32, trailer=1 — match the FMD
    // Android verifier's
    // `PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, 32, 1)`
    // at `CypherUtils.java:325-326` (canonical source of the four
    // parameters; if the Android client ever changes them, this
    // block plus the matching `forge.pss.create(...)` in
    // `scripts/ring-smoke.mjs` are the only places to update).
    const pss = forge.pss.create(
        forge.md.sha256.create(),
        forge.mgf.mgf1.create(forge.md.sha256.create()),
        32
    );

    const md = forge.md.sha256.create();
    md.update(payload, "utf8");
    const sig = privateKey.sign(md, pss);
    return forge.util.encode64(sig);
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

        // FMD server's commandData struct (backend/apiv1.go:44) and the
        // Android client verifier (FmdServerApiV1Repository.kt:594)
        // both build/sign the same string: "${unixTime}:${data}".
        // Order is timestamp-first, then a literal ASCII colon, then
        // the command. Built here once and passed to signRequest as a
        // single payload (D3 in openspec/changes/fix-ring-signing).
        const payload = `${unixTime}:${command}`;
        const signature = await this.signRequest(payload);

        this.config.log.debug(
            `ring: signed payload length=${payload.length} sig=${signature.slice(0, 8)}...`,
        );

        try {
            // The FMD server's POST /command (apiv1.go:339-353) reads
            // IDT, Data, UnixTime and CmdSig all from the JSON body
            // (struct commandData{IDT, Data, UnixTime, CmdSig}). The
            // CheckAccessTokenAndGetUser call looks up data.IDT — the
            // access token MUST go into the body, not the header,
            // otherwise the server replies 401 ERR_ACCESS_TOKEN_INVALID.
            // The CmdSig field is the base64 RSA-PSS signature over
            // "UnixTime:Data" (built in signRingPayload).
            await this.httpClient.post("/api/v1/command", {
                IDT: this.config.authTokens.accessToken,
                Data: command,
                UnixTime: unixTime,
                CmdSig: signature,
            });
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
    private async signRequest(payload: string): Promise<string> {
        try {
            return signRingPayload(this.config.authTokens.privateKey, payload);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to sign request: ${errorMsg}`);
            throw new Error(`Failed to sign request: ${errorMsg}`);
        }
    }
}
