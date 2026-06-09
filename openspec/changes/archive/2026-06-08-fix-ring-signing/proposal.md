# Proposal: Fix ring command signing (Bug S)

## Why

`FmdApi.sendRingCommand` signs the wrong payload. The current
implementation signs `Data:UnixTime` (colons in the wrong order); the
FMD server expects the signature over `UnixTime:Data`. Confirmed in
two places on the server side:

- `backend/apiv1.go:44` — the `commandData` struct comment:
  `CmdSig   string // base64-encoded signature over "UnixTime:Data"`
- The Android client builds the same string when verifying on receive:
  `CypherUtils.verifySig(publicKeyPem, "$time:$command", sig)` at
  `FmdServerApiV1Repository.kt:594`.

Once the previous change `fix-auth-bug` made the auth flow succeed,
`onStateChange → triggerRing → FmdApi.sendRingCommand` actually fires
the HTTP request for the first time. The FMD server accepts the
request body (it only validates the access token via
`CheckAccessTokenAndGetUser` in `postCommand`) but the **device app
silently drops the command** on its next `GET /command` poll because
`CypherUtils.verifySig(publicKeyPem, "$time:$command", sig)` returns
`false`. The user sees the adapter log `Ring command sent to device:
<id>` and nothing happens on the phone.

There is also a second correctness issue adjacent to the signing bug:
the current code uses `crypto.subtle.sign({ name: "RSA-PSS", saltLength:
32 })` but does not declare a hash explicitly in the algorithm import
key params. The Android verifier uses
`PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, 32, 1)`.
The salt length is correct (32 bytes), but the **trailer field** in
PSS defaults differ between Java and WebCrypto: Java uses `1` (the
modern trailer), WebCrypto's default is also `1`, so this happens to
match — but only by accident, and the spec should pin both for
defensibility. PSS salt length 32 in the FMD protocol is the hash
output size (SHA-256 = 32 bytes), which is a deliberate FMD choice,
not a default.

## What Changes

- **Flip the signed-string concatenation in
  `FmdApi.sendRingCommand`.** `signRequest` SHALL sign
  `${UnixTime}:${Data}` (server's documented order), not
  `${Data}:${UnixTime}`. The header names, the body shape, and the
  endpoint (`POST /api/v1/command`) are already correct.
- **Pin the PSS parameters** in the `crypto.subtle.importKey` and
  `crypto.subtle.sign` calls so the salt length and hash algorithm are
  explicit. Match the Android verifier
  (`SHA-256`, MGF1, salt 32, trailer 1).
- **Make the signed payload a single source of truth.** The
  `dataToSign` string is built once in `sendRingCommand` and passed
  into `signRequest` (it currently re-derives the string from
  `data` and `unixTime` inside `signRequest`, which is fine but
  invites a second copy of the format if the signature needs to
  travel with the request elsewhere — keep one helper).
- **Add a debug log line in `sendRingCommand`** that logs the
  signed-string length and the first 8 chars of the base64 signature
  on `debug`, so a future signing-bug can be diagnosed without
  re-reading the source.
- **Add `scripts/ring-smoke.mjs`** that posts a real `ring:<id>` to
  the FMD server and reports whether the server accepted it, so the
  fix can be verified outside the Docker container. The script is
  paired with the `auth-smoke.mjs` shipped in the previous change.
- **No** change to the public API of `FmdApi`. The
  `sendRingCommand(deviceId)` signature is preserved. **No** change
  to `FmdAuth`, `main.ts`, `io-package.json`, or the Admin-UI. **No**
  new top-level dependency.

## Capabilities

### New Capabilities

- `fmd-ring-signing`: How the adapter signs ring commands before
  sending them to the FMD server. The spec covers the exact payload
  format (`${UnixTime}:${Data}`), the PSS parameters (SHA-256, MGF1,
  salt 32 bytes, trailer 1), the failure modes (sign throws, server
  rejects body, server accepts body but device verifier rejects), and
  how those failures surface to the user (via `info.lastError` and
  the live Connection Status panel).

### Modified Capabilities

- `fmd-ring-trigger`: The "ring state changes trigger the FMD ring
  command" requirement gains a sub-clause: the command MUST be
  signed in the form the FMD server (and its connected device app)
  expects. This is a small delta, but it is a requirement change
  rather than a pure implementation detail, so it gets a delta spec
  under `specs/fmd-ring-trigger/`.

## Impact

- **`src/lib/fmd-api.ts`:** two surgical edits — flip the
  `dataToSign` concatenation and pin the PSS params. The
  `sendRingCommand`, `buildAuthHeaders`, and `base64ToBytes` /
  `bytesToBase64` methods are otherwise unchanged.
- **`src/main.ts`:** no change. The ring-dispatch flow in
  `triggerRing` and the user-data subscribe path are unaffected.
- **`src/lib/fmd-auth.ts`:** no change. Auth worked end-to-end after
  the previous change; the issue is downstream of the access token.
- **No** change to `io-package.json`, the Admin-UI, the deployment
  workflow, or any previously-archived change.
- **No** new top-level dependency. `crypto.subtle` is in Node 22's
  global namespace, no `node-rsa` or `node-forge` is needed.
- **New file:** `scripts/ring-smoke.mjs` (developer tool, paired with
  the `auth-smoke.mjs` from `fix-auth-bug`).
- **Side benefit:** the Admin-UI's existing `info.lastError` will now
  surface signing errors that the server already tolerates (e.g.
  crypto.subtle throwing on a malformed PEM). Today those errors are
  silent.
