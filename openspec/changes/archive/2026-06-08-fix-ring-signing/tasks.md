# Tasks: Fix ring command signing (Bug S)

## 1. Spike: confirm the FMD server's signed-payload format

- [x] 1.1 Read the `commandData` struct comment at
  `backend/apiv1.go:44` of the FMD server source
  (`/Users/tschnurre/external-GIT/fmd-server`) — confirms the
  format is `UnixTime:Data`
- [x] 1.2 Read the Android client verify call at
  `FmdServerApiV1Repository.kt:594` of the FMD Android source
  (`/Users/tschnurre/external-GIT/fmd-android`) — confirms the
  device-side format is `$time:$command`
- [x] 1.3 Read the Android verifier's PSS parameters at
  `CypherUtils.java:325-326` — confirms `SHA-256`, MGF1, salt 32,
  trailer 1
- [x] 1.4 Confirm the FMD server's `postCommand` does **not**
  verify the signature on the write side (`backend/apiv1.go:339-353`
  → `SetCommandToUser` stores `Data`, `UnixTime`, `CmdSig` verbatim)
  — explains why the wrong signature was silently accepted

## Spike findings (captured 2026-06-08)

The bug is a 1-character flip: the adapter signs `${data}:${unixTime}`,
the server's documented format is `${unixTime}:${data}`. Confirmed in
two independent source locations:

- FMD server, `backend/apiv1.go:44`:
  `CmdSig   string // base64-encoded signature over "UnixTime:Data"`
- FMD Android, `FmdServerApiV1Repository.kt:594`:
  `if (!CypherUtils.verifySig(publicKeyPem, "$time:$command", sig))`

The FMD server's `postCommand` handler does **not** verify the
signature on the write side — it only checks the access token via
`CheckAccessTokenAndGetUser`. This is why the wrong signature was
silently accepted: the server returns 200, stores the bad signature,
and the device app's `verifySig` call returns `false` on the next
`GET /command` poll, silently dropping the ring.

PSS parameters: the Android verifier uses
`PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, 32, 1)`.
The current adapter's `importKey` (`hash: "SHA-256"`) and `sign`
(`saltLength: 32`) calls match the hash and the salt length, but
neither the MGF1 hash nor the trailer field is pinned — both happen
to match by WebCrypto default but should be commented for
defensibility.

## 2. Flip the signed payload in `FmdApi.signRequest`

- [x] 2.1 In `src/lib/fmd-api.ts`, change the `signRequest` method
  signature from `signRequest(data: string, unixTime: number)` to
  `signRequest(payload: string)`. Remove the `data`/`unixTime`
  parameter coupling from the helper.
- [x] 2.2 In `src/lib/fmd-api.ts`, move the payload-building line
  out of `signRequest` and into `sendRingCommand`. Build the
  payload as `${unixTime}:${command}` (where `command` is
  `ring:<deviceId>`), then call `signRequest(payload)`.
- [x] 2.3 Update the comment block above `signRequest` to cite the
  FMD server source (`backend/apiv1.go:44`) and the Android client
  source (`FmdServerApiV1Repository.kt:594`) as the two
  confirmations of the `${unixTime}:${data}` order.
- [x] 2.4 Confirm the public method signature of `sendRingCommand`
  is unchanged: still `sendRingCommand(deviceId: string): Promise<void>`.

## 3. Pin the PSS parameters

- [x] 3.1 In `src/lib/fmd-api.ts`, add an inline comment above the
  `importKey` call noting that the `hash: "SHA-256"` matches the
  Android verifier's `PSSParameterSpec("SHA-256", ...)`.
- [x] 3.2 Add an inline comment above the `sign` call noting that
  `saltLength: 32` matches the Android verifier's salt length of 32
  bytes, and that the trailer field defaults to 1 (modern PSS) in
  both WebCrypto and the Android verifier.
- [x] 3.3 Verify the existing `saltLength: 32` is unchanged (the
  spike confirmed it is correct; the change is comment-only).

## 4. Debug log line

- [x] 4.1 In `src/lib/fmd-api.ts`, in `sendRingCommand`, after
  `signRequest` returns, log at `debug`:
  `this.config.log.debug(\`ring: signed payload length=\${payload.length} sig=\${signature.slice(0, 8)}...\`);`
- [x] 4.2 Verify that the full signature is never logged at any
  level (grep the file for `signature` and confirm only the
  8-char slice and the `bytesToBase64` call are present).

## 5. Standalone dry-run script

- [x] 5.1 Create `scripts/ring-smoke.mjs` (ESM, `.mjs` extension
  matching `auth-smoke.mjs` from `fix-auth-bug`) that reads
  `FMD_SERVER_URL`, `FMD_USERNAME`, `FMD_PASSWORD`, and
  `FMD_DEVICE_ID` from `process.env`.
- [x] 5.2 The script imports `FmdAuth` and `FmdApi` from
  `src/lib/fmd-auth.ts` and `src/lib/fmd-api.ts` (or instantiates
  inline if the imports prove awkward — see spike 5.6) and runs
  `authenticate()` → `sendRingCommand(deviceId)`.
- [x] 5.3 On success: print `OK server accepted ring command` and
  exit 0.
- [x] 5.4 On FMD server 4xx/5xx: print the status and body and
  exit 1.
- [x] 5.5 On missing env: print the name of the first missing
  variable and exit 2.
- [x] 5.6 Spike (one-shot): verify the import path. If
  `scripts/ring-smoke.mjs` cannot directly import the TypeScript
  source (because `tsc` is not in the dev-host path), the script
  inlines the auth + API logic (it is ~100 lines). Document the
  decision in a comment at the top of the script.
- [x] 5.7 Add an `npm run ring:smoke` script to `package.json` so
  the developer does not need to remember the filename.

## 6. Verify in the Docker container

- [ ] 6.1 `npm run build:tsc` on the dev host to confirm the
  changed `signRequest` and `sendRingCommand` type-check and the
  `build/main.js` is rebuilt.
- [ ] 6.2 `git push` and follow the deployment workflow in
  `CLAUDE.md` (no `npm run build:admin` is needed; this change is
  in `src/lib/`, not `src-admin/`).
- [ ] 6.3 `docker exec iobroker-fmd-dev iobroker logs iobroker-fmd
  --files=15` should show the existing
  `Ring command sent to device: <id>` log line after the
  Shelly button triple-push or a manual
  `setState 0_userdata.0.FindMyDevice.ring.<id> true`.
- [ ] 6.4 The phone rings within ~5 s of the trigger (the
  end-to-end success criterion that the previous change's smoke
  script could not confirm — this change's smoke script
  partially confirms it; the phone is the final check).

## 7. Verify the smoke script catches a wrong signature

- [ ] 7.1 Temporarily revert the change in 2.2 (flip the
  concatenation back to `${data}:${unixTime}`) and re-run
  `node scripts/ring-smoke.mjs`. The script SHOULD print
  `OK server accepted ring command` (the server does not verify
  the signature, so it accepts both orders).
- [ ] 7.2 Restore the `${unixTime}:${data}` order. Re-run the
  smoke script. Still `OK`.
- [ ] 7.3 Document the limitation in `scripts/ring-smoke.mjs`'s
  header comment: the script confirms "the server accepted the
  request" but does **not** confirm "the device app will verify
  the signature"; the phone is the only ground truth.

## 8. Documentation

- [x] 8.1 Update `docs/admin-ui.md` is **not** required (no
  Admin-UI changes).
- [x] 8.2 Update `docs/vision.md` is **not** required (no
  project-vision changes).
- [x] 8.3 Add a one-paragraph note in the project's `README.md`
  Troubleshooting section explaining how the ring signing flow
  works and pointing at `scripts/ring-smoke.mjs` for
  end-to-end debugging.
- [x] 8.4 Update `CLAUDE.md` deployment workflow to mention
  `node scripts/ring-smoke.mjs` as a first step when the ring
  path is misbehaving, before going through the full Docker
  rebuild.
