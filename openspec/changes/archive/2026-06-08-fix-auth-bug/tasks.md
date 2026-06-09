# Tasks: Fix FMD Authentication (Bug D)

## 1. Spike: confirm the FMD server's actual protocol on the wire

- [x] 1.1 From the dev host, run `node scripts/auth-smoke-stub.mjs` (a 30-line throwaway that calls `GET /api/v1/auth/salt` with the test credentials and prints the first 80 chars of the response) to capture the **actual** salt format the server sends
- [x] 1.2 If the response is JSON, identify the field name (`salt` vs `salt_b64` vs `salt_hex`) and the Base64 alphabet
- [x] 1.3 Capture the actual `Content-Type` and the full `/api/v1/auth/salt` response body for the design log

## Spike findings (captured 2026-06-08)

The FMD server's auth protocol (v0.14.0, confirmed against the source in
`/Users/tschnurre/external-GIT/fmd-server`):

- **Endpoint:** `POST /salt` (also reachable as `POST /api/v1/salt`)
  - Request body: `{"IDT": "<username>"}` (the field name is literally
    `IDT`, not `id` or `username`).
  - Response body: `{"IDT": "<username>", "Data": "<salt-b64>"}`.
  - Status: 200 on success, 400 with `Invalid FMD ID` if the IDT
    does not match `^[-_a-zA-Z0-9]{1,64}$`, 400 with `Invalid JSON` if
    the body is not JSON.
- **Salt encoding:** URL-safe Base64 (alphabet `-_`, no `=` padding),
  22 chars = 16 bytes. Confirmed by
  `node -e "...POST /salt {IDT:'eLZo3'}"` against the live server:
  `{"IDT":"eLZo3","Data":"xBO0AzG482Pze7UAd8vdqg"}`.
- **Access endpoint:** `POST /access` (also `/api/v1/access`). Body:
  `{"IDT": "<username>", "PasswordHash": "<hex>", "SessionDurationSeconds": <int>}`.
- **Private-key endpoint:** `GET /key` with `IDT` header (the access
  token). Returns the RSA private key in PEM form.

These three facts are enough to write `deriveKey`, the Base64 codec,
and the auth smoke script without further guessing.

## 2. Pick the Argon2id library

- [x] 2.1 Run a 30-line spike in `/tmp` that installs `argon2` and `hash-wasm` side-by-side and times one `hash(pw, { memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32 })` call on the dev host
- [x] 2.2 If `argon2` builds natively on the dev host (macOS, Node 22), pick it. If not, pick `hash-wasm`
- [x] 2.3 Document the choice (and the timing numbers) in a comment in `package.json#dependencies` so the next person knows

## Library pick: `hash-wasm` (final, after spike revealed t=1 requirement)

First pick was `argon2` (25 ms, native), but the smoke test against
the real server failed with `Invalid timeCost, must be between 2
and 4294967295`. The `argon2` npm package enforces `timeCost >= 2`;
the FMD spec requires `timeCost = 1` (verified against
`/Users/tschnurre/external-GIT/fmd-android` `CypherUtils.java`
`ARGON2_T = 1`). `hash-wasm` (98 ms per hash) accepts t=1 and
produces the same PHC string as the Android Bouncy Castle
implementation. Library swapped in commit `1de2401`.

Performance is irrelevant: this runs once per adapter start.

## 3. Rewrite `deriveKey`

- [x] 3.1 Replace the PBKDF2 call in `src/lib/fmd-auth.ts` with `argon2.hash(this.config.password, { type: argon2.argon2id, salt: saltBytes, memoryCost: 65536, timeCost: 3, parallelism: 4, hashLength: 32, raw: true })` (or the `hash-wasm` equivalent)
- [x] 3.2 Keep the method signature `deriveKey(salt: string): Promise<string>` unchanged
- [x] 3.3 Update the comment block at the top of `deriveKey` to match the implementation
- [x] 3.4 Add a length-only log line in `authenticate()`: `info.lastError` and `info` both stay free of secrets, but `debug` logs `salt.length` and the first 4 salt bytes (hex) so future debugging does not require a full re-derivation

## 4. URL-safe Base64 codec

- [x] 4.1 Rewrite `base64ToBytes` to first try standard Base64, then URL-safe Base64, then throw a clear `Error` listing the input and the failure reason
- [x] 4.2 Keep `bytesToBase64` producing standard Base64 with `=` padding (the FMD `/api/v1/auth/login` endpoint expects standard Base64 for the derived key)
- [x] 4.3 Add a unit test for both helpers: standard round-trip, URL-safe decode, mixed input, garbage input throws

## 5. Standalone dry-run script

- [x] 5.1 Create `scripts/auth-smoke.mjs` (ESM, `.mjs` extension so we don't need a repo-wide `"type": "module"`) that reads `FMD_SERVER_URL`, `FMD_USERNAME`, `FMD_PASSWORD` from `process.env` and runs `FmdAuth.authenticate()`
- [x] 5.2 On success: print `OK access_token=<first 8 chars>... private_key=<first 8 chars>...` and exit 0
- [x] 5.3 On failure: print the error message and exit 1
- [x] 5.4 On missing env: print which variable is missing and exit 2
- [x] 5.5 Add an `npm run auth:smoke` script to `package.json` so the developer does not need to remember the filename

## 6. Verify in the Docker container

- [x] 6.1 `npm install` on the dev host to pull `argon2` (or `hash-wasm`) into `node_modules/`
- [x] 6.2 `npm run build:tsc` to confirm the new `deriveKey` type-checks and the `build/main.js` is rebuilt
- [x] 6.3 `git push` and follow the deployment workflow in `CLAUDE.md` (no `npm run build:admin` is needed; this change is in `src/lib/`, not `src-admin/`)
- [x] 6.4 After `iobroker restart iobroker-fmd.0`, `docker exec iobroker-fmd-dev iobroker logs iobroker-fmd --files=15` should show `FMD authentication successful` (vs. the current `Key derivation failed`)
- [x] 6.5 The Admin-UI's Connection Status panel flips from `Status: error` to `Status: connected` within 5 s

## 7. Verify the rest of the chain lights up

- [ ] 7.1 With `Status: connected`, the Devices panel in the Admin-UI lists the user's FMD devices (created by `fetchDevices` as `0_userdata.0.FindMyDevice.ring.<id>`)
- [ ] 7.2 Setting `0_userdata.0.FindMyDevice.ring.eLZo3 = true` (or whichever device ID the user has) in the GUI produces `Ring state triggered for device: eLZo3` in the adapter log and triggers a real ring on the phone
- [ ] 7.3 The Hardware Button Trigger panel's `Default Ring Device` field, when set to a real device ID and the panel's `Button State ID` is set to the Shelly state, fires a ring on `triple_push`

## 8. Documentation

- [ ] 8.1 Update `docs/admin-ui.md` "Module-federation contract" section is not needed (no admin-UI changes); instead add a one-paragraph note in the project's `README.md` (Configuration section or Troubleshooting) explaining the FMD auth flow and pointing at the smoke script for debugging
- [ ] 8.2 Update `CLAUDE.md` deployment workflow to mention `node scripts/auth-smoke.mjs` as a first step when auth is misbehaving, before going through the full Docker rebuild
