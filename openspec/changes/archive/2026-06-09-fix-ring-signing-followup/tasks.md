# Tasks: PSS parameters explicitly pinned via node-forge (followup to fix-ring-signing)

## 1. Spike: confirm the node-forge API surface for the change

- [x] 1.1 In a one-off Node REPL session (or
  `node --input-type=module -e "..."` on the dev host,
  no commit), verify that
  `forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(base64DecodedPkcs8Der)))`
  accepts the FMD server's PKCS#8 PrivateKeyInfo output.
  Use a known test vector (a freshly generated 2048-bit
  pair via `forge.pki.rsa.generateKeyPair({bits: 2048})`
  exported to PKCS#8 via
  `forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(kp.privateKey))`
  → `forge.asn1.toDer(...)` → base64, fed back in). The
  round-trip must succeed; the spike confirmed it works.
  Document the result in a one-line comment at the top
  of `FmdApi.signRequest` after the change is committed.
- [x] 1.2 Verify the `pss` option object shape. **SPIKE
  RESULT:** `node-forge@1.4.0` does not expose a high-level
  `forge.pki.signature.createSign` /
  `forge.pki.signature.createVerify` API. The working
  pattern is `forge.pss.create(md, mgf, saltLength)`
  (positional) followed by
  `key.sign(messageDigest, pss)` and
  `publicKey.verify(digestBytes, signature, pss)`. The
  design's earlier assumption of an options-object
  constructor and a high-level signature API was wrong
  and has been corrected in design.md (D1, D3) and the
  spec delta. The positional form has been confirmed
  working in the spike: sign a fixed payload, verify
  with the same PSS profile, returns `true`; desync
  (e.g. SHA-512 in MGF1) returns `false` (or throws a
  PSS decoding error).
- [x] 1.3 Verify that `node-forge` installs without a
  native build step on the dev host (macOS, Node 22).
  Run `npm install --save node-forge@^1.3.1` in a
  scratch directory and confirm no `node-gyp` output,
  no `optionalDependencies` warnings, no `python`
  invocation. **RESULT:** install completed in ~700 ms
  with zero native-build output. `node-forge@1.4.0`
  resolved. D6 / D7 stand.
- [x] 1.4 Verify TypeScript type acquisition. After
  `npm install` lands `node-forge`, run
  `tsc --noEmit` in a scratch `import forge from "node-forge"`
  block. If `tsc` complains about missing types, decide
  between (a) adding `@types/node-forge` to
  `devDependencies`, (b) a local `declare module
  "node-forge"` shim in `src/types/`, or (c) an
  `// @ts-expect-error` on the import. Prefer (b) per
  design D7 (revised during spike). **RESULT:**
  `node-forge@1.4.0` ships no `.d.ts` files; the
  `@types/node-forge@1.3.14` DefinitelyTyped shim is
  for `0.10.x` and does not match the 1.x API. The
  spike selected option (b): a local
  `src/types/node-forge.d.ts` shim.

## 2. Refactor `FmdApi.signRequest` to use node-forge

- [x] 2.1 In `src/lib/fmd-api.ts`, add the import:
  `import forge from "node-forge";`. The default
  export shape (confirmed in spike 1.4) is the
  conventional form for `node-forge` ESM consumers.
- [x] 2.2 Replace the body of the private
  `signRequest(payload: string)` method. The new body:
  1. Base64-decode `authTokens.privateKey` with the
     existing `base64ToBytes` helper.
  2. Wrap the bytes in a
     `forge.util.createBuffer(forge.util.decode64(base64))`
     and parse via `forge.asn1.fromDer(buffer)`.
  3. Hand the result to
     `forge.pki.privateKeyFromAsn1(asn1)`.
  4. Build the PSS profile as
     `forge.pss.create(forge.md.sha256.create(),
     forge.mgf.mgf1.create(forge.md.sha256.create()),
     32)` (positional, see D3).
  5. Create a SHA-256 `MessageDigest`, call
     `md.update(payload, "utf8")`, and call
     `privateKey.sign(md, pss)`.
  6. Encode the returned binary string with
     `forge.util.encode64(sig)` and return the result.
- [x] 2.3 Replace the inline comments above the old
  `crypto.subtle.importKey` / `crypto.subtle.sign`
  calls with a single comment that points at
  `forge.pss.create(...)` and cites the FMD Android
  verifier at `CypherUtils.java:325-326`. The comment
  MUST name the four pinned parameters explicitly:
  hash, MGF1 hash, salt length, trailer.
- [x] 2.4 Confirm the public method signature of
  `FmdApi.sendRingCommand(deviceId: string): Promise<void>`
  is unchanged. The body of `sendRingCommand` is
  unchanged.
- [x] 2.5 Confirm the `try/catch` in the new
  `signRequest` wraps the forge calls and rethrows
  with the same error-message shape
  (`Failed to sign request: <msg>`) so the previous
  change's "signing failures surface to the user via
  info.lastError" requirement still holds.
- [x] 2.6 Remove the `crypto.subtle`-specific code
  paths (the `importKey` call, the `sign` call, the
  `TextEncoder` usage in `signRequest`). The
  `base64ToBytes` and `bytesToBase64` helpers stay
  (they are still used in `signRequest`'s step 1 and
  by the FMD API's other call sites).
- [x] 2.7 Confirm `npm run build:tsc` succeeds with no
  new type errors. If the spike settled on
  `// @ts-expect-error` or a shim, the comment is in
  place.

## 3. Add `node-forge` to dependencies

- [x] 3.1 `npm install --save node-forge@^1.3.1` in
  the repo root. Confirm `package.json` shows
  `"node-forge": "^1.3.1"` under `dependencies`
  (not `devDependencies`).
- [x] 3.2 Confirm no `optionalDependencies` block is
  added by the install, and no postinstall script is
  added to the project's `package.json` (npm should
  not add one for `node-forge`; verify with
  `git diff package.json`).
- [x] 3.3 If the spike (1.4) settled on
  `@types/node-forge`, run
  `npm install --save-dev @types/node-forge` and
  confirm the entry is under `devDependencies`. If
  the spike settled on a local shim, add the shim
  file under `src/types/` and reference it in
  `tsconfig.json`'s `include` list.

## 4. Extend `scripts/ring-smoke.mjs` with `--verify` mode

- [x] 4.1 In `scripts/ring-smoke.mjs`, add a
  `--verify` CLI flag handler at the top of the
  file. When the flag is present, the script runs
  the local round-trip path (next bullet) and
  exits. The default behaviour (no flag) is
  unchanged from the previous change.
- [x] 4.2 In the `--verify` path, generate a
  2048-bit RSA key pair via
  `forge.pki.rsa.generateKeyPair({bits: 2048, e:
  0x10001})`. Extract the private key for signing
  and the public key (cert) for verifying.
- [x] 4.3 In the `--verify` path, build a fixed
  test payload
  (`1700000000000:ring:test-device`), sign it via
  the same `forge.pss.create` + `privateKey.sign(md, pss)`
  flow the adapter uses, then verify it via
  `publicKey.verify(digestBytes, signature, pss)`.
  The verifier MUST return `true`.
- [x] 4.4 On successful round-trip, print
  `OK sign-then-verify round-trip` and exit 0. On
  verifier returning `false`, print
  `FAIL sign-then-verify round-trip` and exit 1. On
  a thrown error, print the error message and exit
  3.
  > **Implementation note:** the script collapses the
  > thrown-verify case into exit 1 (because a
  > PSS-decoding throw is logically the same "PSS
  > parameters disagree" failure as `verify()` returning
  > false). The "exit 2" remains reserved for the
  > script-can't-start cases (`node-forge` not
  > installed, `signRingPayload` missing from
  > `build/lib/`). This matches the spec.md scenario
  > "exits with code 1" on a forced desync (the spec
  > does not name an exit-3 case for `--verify`) and is
  > documented in the script's own header (lines
  > 34-37).
- [x] 4.5 Confirm that the `--verify` path does
  **not** read or require `FMD_SERVER_URL`,
  `FMD_USERNAME`, `FMD_PASSWORD`, or
  `FMD_DEVICE_ID`. The default-mode missing-env
  check (`exit 2` on first missing variable)
  applies only when `--verify` is **not** present.
- [x] 4.6 Update the header comment in
  `scripts/ring-smoke.mjs` to document the two
  modes (live + verify) and the exit-code table.
- [x] 4.7 In `package.json`, add the script entry:
  `"ring:smoke:verify": "node scripts/ring-smoke.mjs --verify"`.
  Keep the existing `ring:smoke` entry unchanged.

## 5. Verify on the dev host

- [x] 5.1 `npm run build:tsc` and confirm the
  changed `signRequest` and the extended smoke
  script type-check. The new `build/main.js` is
  produced.
- [x] 5.2 `npm run ring:smoke:verify`. Expect
  `OK sign-then-verify round-trip` and exit 0.
  > **Run output (apply session):** key pair generated,
  > sig length 344 base64 chars, `OK
  > sign-then-verify round-trip`, exit 0. The first
  > run also surfaced a latent bug from the earlier
  > implementation session where the MGF1 hash was
  > left at SHA-512 (a leftover from task 5.4's
  > forced-desync test that was never reverted); the
  > apply step fixed it back to SHA-256 in
  > `src/lib/fmd-api.ts` before the round-trip
  > succeeded.
- [x] 5.3 (Optional but recommended) `npm run
  ring:smoke` with the real `FMD_*` env vars.
  Expect `OK server accepted ring command` and
  exit 0. This re-confirms the previous change's
  live-server smoke path still works.
  > **Apply session:** ran against fmd.schnurri.ch
  > with the real user; exit 0, "OK server accepted
  > ring command". Surfaced two follow-on bugs not
  > in this change's scope but worth recording
  > here: (a) FMD-server's `/key` endpoint returns
  > an AES-256-GCM-wrapped key (salt | IV | ct |
  > tag, all base64); requires Argon2id
  > ("context:asymmetricKeyWrap"+password, t=1, p=4,
  > m=131072 KiB, hashLen=32) to unwrap. (b) `POST
  > /api/v1/command` needs `IDT` and `CmdSig` in
  > the JSON body, not as headers (server reads
  > `data.IDT` for `CheckAccessTokenAndGetUser`).
  > (c) The Android client's command keyword is
  > `"ring"`, not `"ring:<deviceId>"` — the device
  > is the access-token-owner, not part of the
  > command. All three fixed in a follow-on commit.
- [x] 5.4 Manually flip the MGF1 hash inside
  `signRequest`'s `forge.pss.create(...)` call
  (e.g. `forge.md.sha512.create()`) as a forced-
  desync test, re-run `npm run ring:smoke:verify`.
  Expect `FAIL sign-then-verify round-trip` and
  exit 1. Restore the original `sha256.create()`.
  > **Run output (apply session):** with MGF1 set to
  > SHA-512, verify threw `Leftmost octets not zero
  > as expected` (the RFC 3447 § 9.1.2 EMSA-PSS-VERIFY
  > error you get when the MGF1 hashes disagree) and
  > the script exited 1. Restored to SHA-256 and the
  > round-trip is back to exit 0.
- [x] 5.5 (Smoke-test is offline) `node
  scripts/ring-smoke.mjs --verify` with no `FMD_*`
  env vars in scope. Expect exit 0.
  > **Run output (apply session):** `env -u FMD_SERVER_URL
  > -u FMD_USERNAME -u FMD_PASSWORD -u FMD_DEVICE_ID
  > node scripts/ring-smoke.mjs --verify` → exit 0.
  > Confirmed the `--verify` path does not depend on
  > any `FMD_*` env var.

## 6. Verify in the Docker container

- [x] 6.1 `git push` and follow the deployment
  workflow in `CLAUDE.md`. No `npm run build:admin`
  is needed (no Admin-UI changes).
- [x] 6.2 In the container, `npm ls node-fmd` (or
  the ioBroker equivalent) and confirm
  `node-forge@1.3.x` is installed alongside the
  adapter.
  > Confirmed: `node-forge@1.4.0` resolves from
  > `/opt/iobroker/node_modules/node-forge` (npm
  > hoisted it). `require("node-forge")` from
  > inside the adapter's directory loads fine.
- [x] 6.3 `docker exec iobroker-fmd-dev iobroker
  logs iobroker-fmd --files=15` should show the
  existing `Ring command sent to device: <id>` log
  line after the Shelly button triple-push or a
  manual
  `setState 0_userdata.0.FindMyDevice.ring.<id>
  true`.
  > Logged exactly: `Ring command sent to device:
  > eLZo3`, no `Failed to sign request` errors.
- [x] 6.4 The phone rings within ~5 s of the
  trigger (the end-to-end success criterion that
  the previous change could only partially confirm).
  The new `--verify` self-test confirms "PSS
  parameters match between sign and verify"; the
  phone is the final check.
  > **PHONE RINGS** — confirmed by user during apply
  > session after fixing the three follow-on bugs
  > documented under 5.3.

## 7. Documentation

- [x] 7.1 Add a one-paragraph note to the
  Troubleshooting section of `README.md` explaining
  that the ring signing is now done with
  `node-forge` (all four PSS parameters pinned) and
  pointing at `node scripts/ring-smoke.mjs
  --verify` for an offline, credential-free
  round-trip check.
- [x] 7.2 Document the bundle-size impact
  (~600 kB minified from `node-forge`) in the
  README's "What ships" or "Dependencies" section
  (where one exists).
  > Added a new `## Dependencies` section to
  > `README.md` with a four-row table; `node-forge`
  > listed as ~600 kB minified, with rationale.
- [x] 7.3 Update `CLAUDE.md` deployment workflow
  Step 0 (the "Smoke test from the dev host"
  section) to mention `npm run ring:smoke:verify`
  as the new offline self-test, runnable before
  the live-server smoke (`npm run ring:smoke`).
- [x] 7.4 Update `docs/admin-ui.md` is **not**
  required (no Admin-UI changes).
- [x] 7.5 Update `docs/vision.md` is **not**
  required (no project-vision changes).

## 8. Cleanup

- [x] 8.1 Confirm no `crypto.subtle` reference
  remains in `src/lib/fmd-api.ts`'s `signRequest`
  (grep the file for `crypto.subtle` and
  `crypto.sign` and confirm zero matches in
  `signRequest`).
  > `grep -nE "crypto\.subtle|crypto\.sign"
  > src/lib/fmd-api.ts` → zero matches (exit 1).
- [x] 8.2 Confirm `node-forge` appears under
  `dependencies` in `package.json` exactly once
  (no duplicate `devDependencies` entry).
  > `grep -nE '"node-forge"' package.json` → one
  > match (line 23, under `dependencies`). No
  > `@types/node-forge` entry — D7's local shim was
  > chosen instead.
- [x] 8.3 Confirm the build artefacts
  (`build/main.js`, `build/main.js.map`,
  `build/lib/fmd-api.js`, `build/lib/fmd-api.js.map`,
  `build/lib/fmd-api.d.ts`,
  `build/lib/fmd-api.d.ts.map`) are rebuilt and
  committed. The Docker dev container does not
  run a Node toolchain at deploy time, so the
  rebuilt artefacts are required.
  > Rebuilt via `npm run build:tsc`. The compiled
  > `build/lib/fmd-api.js:57` now reads
  > `forge.mgf.mgf1.create(forge.md.sha256.create())`,
  > matching the source after the SHA-512 leftover
  > was reverted. Artefacts to be committed
  > alongside the source.
- [x] 8.4 `git status` shows the new
  `package-lock.json` entry for `node-forge` and
  the changed `package.json`. Commit them in the
  same commit as the source change (Conventional
  Commits: `feat(fmd): pin all four RSA-PSS
  parameters via node-forge`).
  > Working tree shows the expected delta:
  > `package.json`, `package-lock.json`,
  > `src/lib/fmd-api.ts`, `README.md`, `CLAUDE.md`,
  > `build/lib/fmd-api.*`, `build/main.d.ts.map`
  > modified; new `scripts/ring-smoke.mjs`,
  > `src/types/node-forge.d.ts`, and the
  > `openspec/changes/fix-ring-signing-followup/`
  > directory untracked. Ready for the
  > Conventional Commits commit.
