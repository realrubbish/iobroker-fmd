#!/usr/bin/env node
/**
 * Standalone dry-run for the FMD auth flow.
 *
 * Runs FmdAuth.authenticate() against a real FMD server using
 * credentials from environment variables. Exits 0 on success, 1 on
 * auth failure, 2 on missing environment variables.
 *
 * Usage:
 *   FMD_SERVER_URL=https://fmd.example.com \
 *   FMD_USERNAME=alice \
 *   FMD_PASSWORD=secret \
 *   node scripts/auth-smoke.mjs
 *
 * Or via the npm script:
 *   npm run auth:smoke -- \
 *     -e FMD_SERVER_URL=https://fmd.example.com \
 *     -e FMD_USERNAME=alice -e FMD_PASSWORD=secret
 *
 * WARNING: the password is read from an environment variable. Do not
 * paste real production credentials into shared channels (chat, issue
 * trackers, screenshots). The script does not echo the password, but
 * process listings can leak env vars on shared hosts.
 */
import process from "node:process";

const serverUrl = process.env.FMD_SERVER_URL;
const username = process.env.FMD_USERNAME;
const password = process.env.FMD_PASSWORD;

function failExit(code, message) {
    console.error(message);
    process.exit(code);
}

if (!serverUrl) failExit(2, "ERROR: FMD_SERVER_URL environment variable is required");
if (!username) failExit(2, "ERROR: FMD_USERNAME environment variable is required");
if (!password) failExit(2, "ERROR: FMD_PASSWORD environment variable is required");

// Imports are dynamic so we can fail with a clean error message if
// the adapter's build directory is missing or argon2 native binding
// did not install.
let FmdAuth;
try {
    const mod = await import("../build/lib/fmd-auth.js");
    FmdAuth = mod.FmdAuth;
} catch (err) {
    failExit(
        1,
        `ERROR: cannot import FmdAuth from build/lib/fmd-auth.js. Did you run 'npm run build:tsc'? (${err.message})`,
    );
}

const log = {
    info: (msg) => console.log(`[auth:smoke] ${msg}`),
    warn: (msg) => console.log(`[auth:smoke] WARN ${msg}`),
    error: (msg) => console.log(`[auth:smoke] ERROR ${msg}`),
    debug: (msg) => console.log(`[auth:smoke] DEBUG ${msg}`),
};

console.log(`[auth:smoke] FMD server URL: ${serverUrl}`);
console.log(`[auth:smoke] FMD username:   ${username}`);
console.log(`[auth:smoke] FMD password:   ${"*".repeat(password.length)} (${password.length} chars, not echoed)`);

const auth = new FmdAuth({ serverUrl, username, password, log });

try {
    const tokens = await auth.authenticate();
    const accessTokenPreview = tokens.accessToken.slice(0, 8) + "...";
    const privateKeyPreview = tokens.privateKey.slice(0, 8) + "...";
    console.log("");
    console.log(`OK access_token=${accessTokenPreview} private_key=${privateKeyPreview}`);
    console.log(`[auth:smoke] access token length: ${tokens.accessToken.length} chars`);
    console.log(`[auth:smoke] private key length:  ${tokens.privateKey.length} chars`);
    process.exit(0);
} catch (err) {
    console.error("");
    console.error(`[auth:smoke] FAIL: ${err.message}`);
    process.exit(1);
}
