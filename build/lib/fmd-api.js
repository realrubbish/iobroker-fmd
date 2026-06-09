"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FmdApi = void 0;
exports.signRingPayload = signRingPayload;
const axios_1 = __importDefault(require("axios"));
const node_forge_1 = __importDefault(require("node-forge"));
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
function signRingPayload(privateKeyBase64, payload) {
    // Spike (1.1 in openspec/changes/fix-ring-signing-followup/tasks.md)
    // confirmed this round-trip:
    //   base64 (PKCS#8 DER, the storage format FMD returns from
    //   `AccessKeyData`) → forge buffer → ASN.1 → RSAPrivateKey.
    //   pki.privateKeyFromAsn1 accepts both PKCS#8 PrivateKeyInfo and
    //   PKCS#1 RSAPrivateKey, so a future FMD server that returns
    //   PKCS#1 would not require a code change here.
    const derBytes = node_forge_1.default.util.createBuffer(node_forge_1.default.util.decode64(privateKeyBase64));
    const asn1 = node_forge_1.default.asn1.fromDer(derBytes);
    const privateKey = node_forge_1.default.pki.privateKeyFromAsn1(asn1);
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
    const pss = node_forge_1.default.pss.create(node_forge_1.default.md.sha256.create(), node_forge_1.default.mgf.mgf1.create(node_forge_1.default.md.sha256.create()), 32);
    const md = node_forge_1.default.md.sha256.create();
    md.update(payload, "utf8");
    const sig = privateKey.sign(md, pss);
    return node_forge_1.default.util.encode64(sig);
}
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
        // FMD server's commandData struct (backend/apiv1.go:44) and the
        // Android client verifier (FmdServerApiV1Repository.kt:594)
        // both build/sign the same string: "${unixTime}:${data}".
        // Order is timestamp-first, then a literal ASCII colon, then
        // the command. Built here once and passed to signRequest as a
        // single payload (D3 in openspec/changes/fix-ring-signing).
        const payload = `${unixTime}:${command}`;
        const signature = await this.signRequest(payload);
        this.config.log.debug(`ring: signed payload length=${payload.length} sig=${signature.slice(0, 8)}...`);
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
    async signRequest(payload) {
        try {
            return signRingPayload(this.config.authTokens.privateKey, payload);
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.config.log.error(`Failed to sign request: ${errorMsg}`);
            throw new Error(`Failed to sign request: ${errorMsg}`);
        }
    }
}
exports.FmdApi = FmdApi;
//# sourceMappingURL=fmd-api.js.map