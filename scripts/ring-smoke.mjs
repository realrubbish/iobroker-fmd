#!/usr/bin/env node
/**
 * Standalone dry-run for the FMD ring command flow.
 *
 * Two modes:
 *
 * 1. Default (no flag). Runs FmdAuth.authenticate() against a real
 *    FMD server, then calls FmdApi.sendRingCommand(deviceId) to post
 *    a `ring:<id>` to `POST /api/v1/command`.
 *
 *    Exit codes:
 *      0 — FMD server returned HTTP 200
 *      1 — 4xx/5xx from the server
 *      2 — missing required env var
 *      3 — thrown error (auth, transport, signing)
 *
 *    Usage:
 *      FMD_SERVER_URL=https://fmd.example.com \
 *      FMD_USERNAME=alice \
 *      FMD_PASSWORD=secret \
 *      FMD_DEVICE_ID=<device-id> \
 *      node scripts/ring-smoke.mjs
 *
 *    Or via the npm script:
 *      npm run ring:smoke
 *
 * 2. `--verify`. Offline sign-then-verify round-trip on a freshly
 *    generated 2048-bit RSA key pair, using the same
 *    `signRingPayload` code path the adapter uses for live ring
 *    commands. Confirms the four PSS parameters (hash, MGF1 hash,
 *    salt length, trailer) are pinned explicitly and the signature
 *    round-trips with the same parameters.
 *
 *    Exit codes:
 *      0 — verifier returned true
 *      1 — verifier returned false (or threw a PSS decoding error)
 *      2 — key generation or sign failure (treated as thrown error)
 *
 *    Usage:
 *      node scripts/ring-smoke.mjs --verify
 *    Or via the npm script:
 *      npm run ring:smoke:verify
 *
 *    The `--verify` mode does NOT read FMD_SERVER_URL, FMD_USERNAME,
 *    FMD_PASSWORD, or FMD_DEVICE_ID. The mode is the first
 *    programmatic check in the repo that "what the adapter signs is
 *    verifiable with the same PSS parameters the FMD Android
 *    verifier uses".
 *
 * LIMITATION (default mode only): the FMD server's `postCommand`
 * handler does NOT verify the signature on the write side (see
 * `backend/apiv1.go:339-353` in the FMD server source). The server
 * only checks the access token, then stores `Data`, `UnixTime`, and
 * `CmdSig` verbatim and pushes the pending command to the device.
 * The device app's `CypherUtils.verifySig` is the only signature
 * check. So a "200 OK from the server" is a weak signal: it confirms
 * the adapter built a structurally valid request and the access
 * token is good, but it does NOT confirm the device app will accept
 * the signature. The phone is the only ground truth. The `--verify`
 * mode is the strongest offline check the repo can run without a
 * phone on hand.
 */
import process from "node:process";

function failExit(code, message) {
    console.error(message);
    process.exit(code);
}

const args = process.argv.slice(2);
const verifyMode = args.includes("--verify");

if (verifyMode) {
    // -----------------------------------------------------------------
    // --verify mode: offline sign-then-verify round-trip
    // -----------------------------------------------------------------
    let forge;
    try {
        const forgeMod = await import("node-forge");
        forge = forgeMod.default || forgeMod;
    } catch (err) {
        failExit(
            2,
            `ERROR: cannot import node-forge. Did you run 'npm install'? (${err.message})`,
        );
    }

    // Generate a 2048-bit RSA key pair with the standard public
    // exponent. node-forge returns the pair synchronously when no
    // callback is supplied, but the underlying PRNG can be slow on
    // first call (~500 ms–2 s on a typical dev host).
    console.log("[ring:smoke --verify] generating 2048-bit RSA key pair...");
    const kp = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    console.log("[ring:smoke --verify] key pair generated");

    // Export the private key to PKCS#8 DER, then base64, so the
    // adapter's signRequest code path runs against the same storage
    // format FMD returns from AccessKeyData.
    const pkcs8Asn1 = forge.pki.wrapRsaPrivateKey(
        forge.pki.privateKeyToAsn1(kp.privateKey),
    );
    const pkcs8Base64 = forge.util.encode64(forge.asn1.toDer(pkcs8Asn1).getBytes());

    // Build the PSS profile with the exact same four parameters the
    // adapter uses. If the adapter's PSS profile drifts, this
    // round-trip will fail.
    const pss = forge.pss.create(
        forge.md.sha256.create(),
        forge.mgf.mgf1.create(forge.md.sha256.create()),
        32,
    );

    // Import the signRingPayload from the built adapter code so the
    // self-test exercises the same signing function the live ring
    // path uses.
    let signRingPayload;
    try {
        const apiMod = await import("../build/lib/fmd-api.js");
        signRingPayload = apiMod.signRingPayload;
        if (typeof signRingPayload !== "function") {
            throw new Error("signRingPayload is not exported from build/lib/fmd-api.js");
        }
    } catch (err) {
        failExit(
            2,
            `ERROR: cannot import signRingPayload from build/lib/. Did you run 'npm run build:tsc'? (${err.message})`,
        );
    }

    const payload = "1700000000000:ring:test-device";
    const sigB64 = signRingPayload(pkcs8Base64, payload);
    console.log(`[ring:smoke --verify] signed payload (sig length=${sigB64.length} base64 chars)`);

    // Verify with the matching PSS profile.
    const verifyMd = forge.md.sha256.create();
    verifyMd.update(payload, "utf8");
    let ok;
    try {
        ok = kp.publicKey.verify(verifyMd.digest().getBytes(), forge.util.decode64(sigB64), pss);
    } catch (err) {
        console.error(`[ring:smoke --verify] FAIL verify threw: ${err.message}`);
        process.exit(1);
    }

    if (ok) {
        console.log("");
        console.log("OK sign-then-verify round-trip");
        process.exit(0);
    } else {
        console.error("");
        console.error("FAIL sign-then-verify round-trip (verifier returned false)");
        process.exit(1);
    }
}

// ---------------------------------------------------------------------
// Default mode: live FMD server round-trip
// ---------------------------------------------------------------------

const serverUrl = process.env.FMD_SERVER_URL;
const username = process.env.FMD_USERNAME;
const password = process.env.FMD_PASSWORD;
const deviceId = process.env.FMD_DEVICE_ID;

if (!serverUrl) failExit(2, "ERROR: FMD_SERVER_URL environment variable is required");
if (!username) failExit(2, "ERROR: FMD_USERNAME environment variable is required");
if (!password) failExit(2, "ERROR: FMD_PASSWORD environment variable is required");
if (!deviceId) failExit(2, "ERROR: FMD_DEVICE_ID environment variable is required");

// Imports are dynamic so we can fail with a clean error message if
// the adapter's build directory is missing. Same pattern as
// scripts/auth-smoke.mjs from the fix-auth-bug change.
let FmdAuth, FmdApi;
try {
    const authMod = await import("../build/lib/fmd-auth.js");
    const apiMod = await import("../build/lib/fmd-api.js");
    FmdAuth = authMod.FmdAuth;
    FmdApi = apiMod.FmdApi;
} catch (err) {
    failExit(
        1,
        `ERROR: cannot import FmdAuth/FmdApi from build/lib/. Did you run 'npm run build:tsc'? (${err.message})`,
    );
}

const log = {
    info: (msg) => console.log(`[ring:smoke] ${msg}`),
    warn: (msg) => console.log(`[ring:smoke] WARN ${msg}`),
    error: (msg) => console.log(`[ring:smoke] ERROR ${msg}`),
    debug: (msg) => console.log(`[ring:smoke] DEBUG ${msg}`),
};

console.log(`[ring:smoke] FMD server URL: ${serverUrl}`);
console.log(`[ring:smoke] FMD username:   ${username}`);
console.log(`[ring:smoke] FMD password:   ${"*".repeat(password.length)} (${password.length} chars, not echoed)`);
console.log(`[ring:smoke] FMD device id:  ${deviceId}`);

let tokens;
try {
    const auth = new FmdAuth({ serverUrl, username, password, log });
    tokens = await auth.authenticate();
    log.info(`auth ok (access_token=${tokens.accessToken.slice(0, 8)}..., private_key=${tokens.privateKey.slice(0, 8)}...)`);
} catch (err) {
    console.error("");
    console.error(`[ring:smoke] AUTH FAIL: ${err.message}`);
    process.exit(1);
}

const api = new FmdApi({ serverUrl, authTokens: tokens, log });

try {
    await api.sendRingCommand(deviceId);
    console.log("");
    console.log("OK server accepted ring command");
    process.exit(0);
} catch (err) {
    console.error("");
    console.error(`[ring:smoke] RING FAIL: ${err.message}`);
    process.exit(3);
}
