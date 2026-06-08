# Proposal: Fix FMD Authentication (Bug D)

## Why

The `iobroker-fmd` adapter cannot authenticate against any FMD server.
The connection status stays at `error` with `Key derivation failed: The
string to be decoded is not correctly encoded.`

A spike against the FMD server source (`/Users/tschnurre/external-GIT/fmd-server`
at tag v0.14.0, matching the running container) revealed that the
adapter's auth code is wrong on **five** axes, not two. The proposal
drafted before the spike underestimated the work:

1. **`deriveKey` is PBKDF2, not Argon2id.** The comment claims Argon2id
   with the FMD-mandated parameters (memory 64 MiB, iterations 3,
   parallelism 4, key length 32). The code calls Web Crypto's PBKDF2.
   Web Crypto has no Argon2 primitive. (Same as the original proposal.)
2. **`base64ToBytes` rejects URL-safe Base64.** FMD salts come back as
   URL-safe Base64 with no padding (e.g. `xBO0AzG482Pze7UAd8vdqg` =
   16 bytes). `atob()` chokes on it. (Same as the original proposal.)
3. **Endpoint shapes are wrong.** The current code calls
   `GET /api/v1/auth/salt` and `POST /api/v1/auth/login`. The real
   server uses `POST /salt` (with `{"IDT": "<username>"}` in the
   body), `POST /requestAccess` (with `{"IDT", "PasswordHash",
   "SessionDurationSeconds"}`), and `POST /key` (with `{"IDT":
   "<accessToken>"}` in the body). There is no `GET /api/v1/auth/salt`
   and no `POST /api/v1/auth/login`; the old paths return HTML from
   the webui.
4. **Argon2id output is PHC-encoded, not raw.** The client must run
   Argon2id with the parameters above and a salt of 16 bytes, then
   extract the **hash portion** (third `$`-separated segment) of the
   resulting PHC string. The server hashes this once more with
   SHA-512 over the string `"context:serverSidePasswordHash" +
   innerPwHash` and compares with the stored value. The current
   `deriveKey` is missing this two-step flow entirely.
5. **`getPrivateKey` is wrong.** Current code does
   `httpClient.get("/api/v1/auth/key", { headers: { IDT: token } })`.
   The real endpoint is `POST /key` with `{"IDT": token}` in the
   **body**, returning the PEM-encoded private key in the `Data`
   field of a `DataPackage`.

The bug was invisible until the OpenSpec change `add-admin-ui-index-html`
landed, which wired `onReady` to call `authenticate()` for the first
time. Without that change, the adapter never attempted the auth flow at
all, so the broken crypto path was never exercised.

## What Changes

- **Rewrite `FmdAuth.deriveKey` entirely.** The method now runs
  Argon2id on the **client** (memory 64 MiB, iterations 3,
  parallelism 4, key length 32) using the server-provided salt,
  produces a PHC-encoded string, and extracts the hash segment
  (standard Base64, no padding). The hash segment is the
  `PasswordHash` to send to `/requestAccess`.
- **Rewrite `FmdAuth.getSalt` and `FmdAuth.login` to use the real
  endpoints.** `getSalt` becomes `POST /salt` with
  `{"IDT": "<username>"}`; `login` becomes
  `POST /requestAccess` with `{"IDT": "<username>", "PasswordHash":
  "<hash>", "SessionDurationSeconds": 86400}`.
- **Rewrite `FmdAuth.getPrivateKey` to use the real endpoint.**
  `POST /key` with `{"IDT": "<accessToken>"}` in the body; response
  `Data` field is the PEM.
- **Add URL-safe Base64 codec.** `base64ToBytes` auto-detects URL-safe
  vs standard; `bytesToBase64` produces standard Base64 with no
  padding (the form FMD expects for `PasswordHash`).
- **Add the new `argon2` runtime dependency.** Used by `deriveKey`
  for the client-side KDF.
- **Add a debug log line in `authenticate()`** that prints the
  length of the salt and the hash (length only — never the values
  themselves), so future debugging does not require re-derivation.
- **Add `scripts/auth-smoke.mjs`** that takes the auth inputs via
  env vars and runs the flow end-to-end against a real FMD server,
  so future auth bugs are debuggable without Docker.
- **No** change to the public API of `FmdAuth` (the four methods
  keep their signatures). **No** change to `io-package.json` or the
  Admin-UI. **No** change to `main.ts`.

## Capabilities

### New Capabilities

- `fmd-auth`: How the adapter authenticates against an FMD server.
  The spec covers the full flow against the **real** endpoints
  (`POST /salt`, `POST /requestAccess`, `POST /key`), the
  client-side Argon2id KDF, the PHC hash extraction, the Base64
  conventions, and how errors surface to the user (via
  `info.lastError` and the live Connection Status panel in the
  Admin-UI).
- `fmd-auth-testing`: How the auth flow is verified outside the
  ioBroker runtime. Covers the `scripts/auth-smoke.mjs` dry-run
  script.

### Modified Capabilities

_None._ This change does not alter the requirements of any existing
capability. The Admin-UI (`admin-ui`, `admin-ui-delivery`
capabilities introduced in the previous change) is unaffected; it
just starts displaying a useful `info.connection` value once the
auth flow works.

## Impact

- **New dependency:** `argon2` (preferred, native, ~5× faster than
  `hash-wasm`) or `hash-wasm` (WASM fallback if native build fails
  in the Docker container). Both are pure runtime deps, not
  devDeps. This is the only new top-level dep.
- **New file:** `scripts/auth-smoke.mjs` (the dry-run script).
- **`src/lib/fmd-auth.ts`:** the `deriveKey`, `getSalt`, `login`,
  and `getPrivateKey` methods are all rewritten; the
  `base64ToBytes` and `bytesToBase64` helpers are generalised to
  URL-safe Base64. The class signature is unchanged.
- **`src/main.ts`:** no change. The `onReady` →
  `connectAndFetchDevices` flow added in the previous change
  already calls `authenticate()` correctly. Once
  `authenticate()` returns real tokens, the rest of the chain
  (`FmdApi` construction, `fetchDevices`, Ring-Trigger) lights up
  automatically.
- **No** change to `io-package.json`, the Admin-UI, the deployment
  workflow, or the OpenSpec change `add-admin-ui-index-html`.
- **No** change to `docs/admin-ui.md`; the Connection Status panel
  described there already covers the `error` case.
