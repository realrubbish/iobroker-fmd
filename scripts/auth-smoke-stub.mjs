#!/usr/bin/env node
/**
 * Throwaway probe for the FMD server's /api/v1/auth/salt endpoint.
 *
 * This script is part of OpenSpec change "fix-auth-bug" Task 1.1. It
 * exists to capture the ACTUAL shape of the salt response from the
 * FMD server the developer is using, so the Base64 / Argon2 fix in
 * deriveKey is not written blind.
 *
 * Run with:
 *   FMD_SERVER_URL=https://fmd.example.com node scripts/auth-smoke-stub.mjs
 *
 * Exits 0 on a 2xx response (regardless of body shape — we want to see
 * everything), 1 on a non-2xx response, 2 on a missing FMD_SERVER_URL.
 *
 * After running, paste the output into the OpenSpec change thread so
 * the implementer can decide whether the salt is URL-safe Base64,
 * standard Base64, hex, or something else.
 */
import { request } from "node:https";
import { URL } from "node:url";

const serverUrl = process.env.FMD_SERVER_URL;
if (!serverUrl) {
    console.error("ERROR: FMD_SERVER_URL environment variable is required");
    console.error("Usage: FMD_SERVER_URL=https://fmd.example.com node scripts/auth-smoke-stub.mjs");
    process.exit(2);
}

let parsed;
try {
    parsed = new URL(serverUrl);
} catch (err) {
    console.error(`ERROR: FMD_SERVER_URL is not a valid URL: ${err.message}`);
    process.exit(2);
}

if (parsed.protocol !== "https:") {
    console.error(`ERROR: FMD_SERVER_URL must be https:// (got ${parsed.protocol})`);
    process.exit(2);
}

const path = "/api/v1/auth/salt";
const options = {
    method: "GET",
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path,
    headers: {
        "User-Agent": "iobroker-fmd-auth-smoke-stub/0.1",
        "Accept": "application/json",
    },
};

console.log(`[smoke-stub] GET https://${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${path}`);

const req = request(options, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        console.log(`[smoke-stub] HTTP ${res.statusCode} ${res.statusMessage || ""}`);
        console.log(`[smoke-stub] Content-Type: ${res.headers["content-type"] || "(none)"}`);
        console.log(`[smoke-stub] Content-Length: ${res.headers["content-length"] || "(none)"}`);
        console.log(`[smoke-stub] Body length: ${body.length} chars`);
        console.log(`[smoke-stub] --- raw body (first 200 chars) ---`);
        console.log(body.slice(0, 200));
        if (body.length > 200) {
            console.log(`[smoke-stub] ... (${body.length - 200} more chars truncated)`);
        }
        console.log(`[smoke-stub] --- end body ---`);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            // Try to parse as JSON for a structured view
            try {
                const json = JSON.parse(body);
                console.log(`[smoke-stub] JSON-parsed keys: ${Object.keys(json).join(", ")}`);
                for (const [k, v] of Object.entries(json)) {
                    const vStr = typeof v === "string" ? v : JSON.stringify(v);
                    const preview = vStr.length > 80 ? vStr.slice(0, 80) + "..." : vStr;
                    console.log(`[smoke-stub]   ${k} (type=${typeof v}, len=${vStr.length}): ${preview}`);
                }
            } catch (err) {
                console.log(`[smoke-stub] Body is not JSON: ${err.message}`);
            }
            process.exit(0);
        } else {
            process.exit(1);
        }
    });
});

req.on("error", (err) => {
    console.error(`[smoke-stub] Request failed: ${err.message}`);
    process.exit(1);
});

req.end();
