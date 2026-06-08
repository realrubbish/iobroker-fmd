# Design: Fix FMD Authentication (Bug D)

## Context

`src/lib/fmd-auth.ts` is labelled "FMD Authentication module, Implements
multi-step auth: Salt → Argon2id → Access Token → Private Key" but the
implementation is wrong on **five** axes, all confirmed against the FMD
server source at `/Users/tschnurre/external-GIT/fmd-server` tag v0.14.0
(matching the running container):

1. **`deriveKey` does PBKDF2, not Argon2id.** The comment claims Argon2id
   with the FMD-specific parameters (memory 64 MiB, iterations 3,
   parallelism 4, key length 32). The code calls
   `crypto.subtle.deriveBits({ name: "PBKDF2", ... })`. Web Crypto has
   no Argon2 primitive.
2. **`base64ToBytes` rejects URL-safe Base64.** FMD salts are URL-safe
   with no padding (e.g. `xBO0AzG482Pze7UAd8vdqg` = 16 bytes).
   `atob()` chokes on it.
3. **Endpoint shapes are wrong.** The current code targets
   `GET /api/v1/auth/salt` and `POST /api/v1/auth/login`. The real
   server uses `POST /salt`, `POST /requestAccess`, and `POST /key`.
   The old paths return HTML from the webui (verified by
   `auth-smoke-stub.mjs` against the live server).
4. **The two-step KDF architecture is missing.** The client is supposed
   to run Argon2id once to produce a PHC-encoded string, then send
   only the **hash portion** of that string (not the PHC wrapper) as
   the `PasswordHash` to the server. The server SHA-512s that hash
   with the prefix `"context:serverSidePasswordHash"` and compares
   with its stored value. See `user/password.go` in the FMD server
   repo for the canonical reference.
5. **`getPrivateKey` is wrong.** The current code does
   `httpClient.get("/api/v1/auth/key", { headers: { IDT: token } })`.
   The real endpoint is `POST /key` with `{"IDT": token}` in the
   **body**, returning the PEM-encoded private key in the `Data`
   field of a `DataPackage`.

All five bugs were latent until the OpenSpec change
`add-admin-ui-index-html` landed, which wired `onReady` to call
`authenticate()` for the first time. The previous behaviour —
`FmdAuth` constructed, never used — hid the broken auth path entirely.

## Goals / Non-Goals

**Goals**

- Real Argon2id key derivation on the **client**, matching the FMD
  server's published parameters.
- A `base64ToBytes` / `bytesToBase64` codec that accepts URL-safe
  input and produces standard Base64 output.
- Endpoint shapes (`POST /salt`, `POST /requestAccess`, `POST /key`)
  and payload shapes (`DataPackage{IDT, Data}`) match the FMD server
  source.
- The two-step KDF (client Argon2id → server SHA-512 with prefix) is
  implemented end-to-end.
- A standalone `scripts/auth-smoke.mjs` that runs the auth flow
  outside the ioBroker container, so future auth bugs are debuggable
  without Docker.
- Strict no-secret-in-logs.
- The Admin-UI's Connection Status panel continues to show the right
  error text when auth fails.

**Non-Goals**

- Replacing the rest of the adapter (`main.ts`, `fmd-api.ts`,
  Ring-Trigger). Those are out of scope.
- Adding automatic re-auth on token expiry. The 1-hour hard-coded
  `expiresAt` is a separate follow-up.
- Changing the public API of `FmdAuth`. `authenticate()`, `getSalt`,
  `deriveKey`, `login`, `getPrivateKey`, `refreshToken` keep their
  signatures.
- Supporting older or non-standard FMD servers. We target exactly
  v0.14.0 of the FMD server.

## Decisions

### D1. Use `argon2` npm package, not `hash-wasm`

- **Decision:** Add `argon2` as a runtime dependency. Use
  `argon2.hash(password, { type: argon2.argon2id, salt, memoryCost: 65536,
  timeCost: 3, parallelism: 4, hashLength: 32, raw: false })`. The
  `raw: false` output is the PHC-encoded string
  (`$argon2id$v=19$m=65536,t=3,p=4$<salt-b64>$<hash-b64>`). We then
  parse the **hash portion** (the 5th `$`-separated segment) as
  standard Base64, no padding, and use that as the `PasswordHash`
  field in the `/requestAccess` request.
- **Why argon2:** Native binding, ~5× faster than `hash-wasm` for the
  parameters we use, and matches the FMD server's `Argon2id` choice
  literally — no risk of "we picked a different Argon2 variant"
  surprises. The PHC-encoded output is what the FMD server expects
  to see in `password.go:getSaltFromArgon2EncodedHash`.
- **Why not hash-wasm:** WASM-only, ~5× slower, but has the advantage
  of no native build step. Useful as a fallback if the Docker
  container cannot build native modules. We pick `argon2` first and
  document `hash-wasm` as the escape hatch in the open questions.
- **Why not roll our own:** Argon2id reference implementations are
  hundreds of lines of constant-time arithmetic. The risk of subtle
  side-channel bugs is too high.

### D2. URL-safe Base64 in `base64ToBytes`, standard no-padding in `bytesToBase64`

- **Decision:** `base64ToBytes` auto-detects URL-safe input
  (`-_` alphabet) vs standard input (`+/`) and decodes accordingly,
  tolerating missing `=` padding. `bytesToBase64` produces
  **standard** Base64 with **no** padding, because:
  - The FMD `PasswordHash` field expects standard Base64 no padding
    (the server uses `base64.StdEncoding.WithPadding(NoPadding)`
    when hashing the incoming value in `password.go`).
- **Why auto-detect in the decoder:** the FMD server returns the salt
  in URL-safe form (confirmed by the live `POST /salt` response:
  `{"Data":"xBO0AzG482Pze7UAd8vdqg"}`). But future server versions
  might switch. Auto-detection is one line of replace-then-try.
- **Why not a separate `base64UrlToBytes`:** callers in `deriveKey`
  benefit from a single, forgiving entry point. Splitting the API
  just to be pedantic about RFC 4648 §5 would create more code than
  it removes.

### D3. The two-step KDF

The client-side auth flow now has **two** crypto operations before
sending the request to the server:

1. **Argon2id** (client-side, in `deriveKey`):
   ```
   argon2.hash(
     password = <Klartext-Passwort>,
     salt = <16 bytes from /salt response, URL-safe decoded>,
     memoryCost = 65536, timeCost = 3, parallelism = 4, hashLength = 32,
     raw = false
   )
   → phcString = "$argon2id$v=19$m=65536,t=3,p=4$<salt-b64>$<hash-b64>"
   ```
2. **PHC parse** (in `deriveKey`):
   ```
   const parts = phcString.split("$");  // → ["", "argon2id", "v=19", "m=65536,t=3,p=4", "<salt-b64>", "<hash-b64>"]
   const passwordHash = parts[5];        // → "<hash-b64>" (standard Base64, no padding)
   ```

The server then does its own SHA-512 over
`"context:serverSidePasswordHash" + passwordHash` and compares. We do
**not** implement the server side; we trust the FMD server.

### D4. Endpoint shapes

The five methods map to the real endpoints as follows:

| Method | Old code | New code |
|---|---|---|
| `getSalt()` | `GET /api/v1/auth/salt` | `POST /salt` with `{"IDT": "<username>"}` |
| `deriveKey(salt)` | PBKDF2 over password | Argon2id + PHC parse (see D3) |
| `login(hash)` | `POST /api/v1/auth/login` with `{username, key}` | `POST /requestAccess` with `{IDT, PasswordHash, SessionDurationSeconds}` |
| `getPrivateKey(token)` | `GET /api/v1/auth/key` with `IDT` header | `POST /key` with `{IDT: <token>}` in body, `Data` is PEM |
| `refreshToken()` | `POST /api/v1/auth/refresh` with `{key}` and `IDT` header | unchanged in shape; will be re-verified in the smoke script |

`SessionDurationSeconds` is set to `86400` (1 day) as a reasonable
default. The server caps at `MAX_TOKEN_VALID_SECS = 7 * 24 * 60 * 60`
(1 week); we stay well within.

### D5. New `scripts/auth-smoke.mjs` dry-run script

- **Decision:** Ship a Node ESM script that takes the auth inputs via
  environment variables (`FMD_SERVER_URL`, `FMD_USERNAME`,
  `FMD_PASSWORD`) and runs the full flow. Exits 0 on success, 1 on
  failure, 2 on missing env. Lives in `scripts/`, not `src/`, because
  it is a developer tool, not part of the adapter runtime.
- **Why:** debugging auth without Docker is currently impossible —
  the only way to see what `deriveKey` does is to start ioBroker,
  watch the logs, hope. A standalone script lets the developer
  iterate on the crypto in seconds. After the spike proved the
  protocol shape, the smoke script is the next-best thing to a
  proper test suite.
- **Why ESM:** the rest of the repo's tooling (Vite, the new admin
  build) is already ESM. `package.json` does not declare `"type":
  "module"` for the project root, so we use the `.mjs` extension to
  make this one file ESM without a global flip.

### D6. Logging policy: length-only for tokens, no password

- **Decision:** `authenticate()` logs the salt's length and first 4
  bytes (hex), the PHC string's length, the access token's length,
  and the private key's length. The password, the full salt, the
  full PHC string, the full access token, and the full private key
  are **never** logged at any level.
- **Why:** when auth fails, the first instinct is to dump everything
  to disk. That instinct must not be rewarded. The length-only
  output is enough to confirm "the salt looked 16 bytes, the PHC
  output is plausibly the expected 90 chars, the access token is
  plausibly JWT-shaped" — and that is enough to debug crypto shape
  problems.

## Risks / Trade-offs

- **[`argon2` native build in Docker]** The Docker dev container
  builds `node_modules` from npm on `iobroker url`. The `argon2`
  package's native binding must compile cleanly under Node 22 / glibc
  inside the container. → **Mitigation:** the auth-smoke script can
  be run from the dev host (macOS, also has a build toolchain) to
  verify the native binding compiles. If the container build fails,
  fall back to `hash-wasm` (pure WASM, no native step).

- **[Password leak via `auth-smoke.mjs` env vars]** The smoke script
  reads `FMD_PASSWORD` from the environment. If the developer pastes
  the env var into a public channel (chat, log, screenshot), the
  password leaks. → **Mitigation:** the script's `--help` output
  warns about this; the README explicitly says "do not paste env
  vars containing real passwords into chat or issue trackers." The
  long-term fix is a credential helper, but that is out of scope
  for this change.

- **[Argon2id parameter drift]** If the FMD server's parameters
  change (memory, iterations, parallelism, key length), the
  hard-coded values in D1 will silently produce wrong keys. →
  **Mitigation:** the parameters are placed in a single `const`
  block at the top of `deriveKey` with a comment pointing at the
  FMD server source. If they change, one place to update.

- **[Token refresh on expiry]** The current 1-hour `expiresAt` is
  a guess. If FMD tokens actually expire sooner, `FmdApi` will start
  failing with 401 and the user will see a runtime error, not an
  auth-time error. → **Mitigation:** the OpenSpec change is scoped
  to login-time auth. A follow-up change will add
  `try { api.listDevices() } catch (401) { auth.refreshToken();
  api.listDevices() }` or equivalent. Out of scope here.

- **[PHC hash vs raw bytes]** The FMD server uses
  `base64.StdEncoding.WithPadding(NoPadding)` when hashing the
  incoming `PasswordHash`. That means no `=` padding in the bytes
  we send. Our `bytesToBase64` (D2) must match exactly. →
  **Mitigation:** the spec scenario "Encode PasswordHash without
  padding" asserts this; the smoke script prints the encoded length
  on success.

## Migration Plan

1. Land the change on `main` behind the normal `git push` + (no
   `npm run build:admin` needed, no admin changes) +
   `docker compose up -d` + `iobroker url` + workdir fix +
   `iobroker upload` + instance restart flow documented in
   `CLAUDE.md`. (Note: `build/main.js` must be committed because
   the container reads it; the previous `fix-auth-bug` change in
   the `add-admin-ui-index-html` change already established this
   convention.)
2. **Before the Docker step**, the developer runs
   `FMD_SERVER_URL=https://fmd.schnurri.ch FMD_USERNAME=eLZo3
   FMD_PASSWORD=<…> node scripts/auth-smoke.mjs` to confirm the
   full flow succeeds against the real server. The script prints
   `OK access_token=<8 chars>... private_key=<8 chars>...` on
   success.
3. The Docker step restarts the adapter; the log shows
   `FMD authentication successful` (vs. the current
   `Key derivation failed`).
4. The Admin-UI's Connection Status panel flips from
   `Status: error` to `Status: connected` within 5 s.

**Rollback:** revert the commit. The previous (broken) auth code is
self-contained in `lib/fmd-auth.ts`; reverting the file restores the
PBKDF2 + wrong-endpoints behaviour. The `scripts/auth-smoke.mjs` is
additive and does not need to be removed for the adapter to function.

## Open Questions

- **Will `argon2`'s native build succeed inside the
  `iobroker/iobroker:latest` Docker image?** If not, the fallback
  is `hash-wasm`. We do not need to decide upfront; the smoke
  script on the dev host will tell us.
- **What session duration does the FMD server actually use for
  `SessionDurationSeconds`?** The smoke script will print the
  access token; we can decode it (it's a JWT) and see its `exp`
  claim.
- **Does the `Data` field of the `/key` response contain a
  newlines-escaped PEM, or a single-line PEM?** The smoke script
  prints the first 80 chars on success, which will tell us.
