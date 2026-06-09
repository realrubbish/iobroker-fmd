# Design: Fix ring command signing (Bug S)

## Context

`src/lib/fmd-api.ts` exposes a `sendRingCommand(deviceId)` method
that builds the FMD server's `commandData` body and posts it to
`POST /api/v1/command`. The body shape, the headers (`IDT` for the
access token, `CmdSig` for the signature), the endpoint, and the
PSS algorithm are all correct. The signed payload is wrong.

`signRequest(data, unixTime)` at `fmd-api.ts:129` builds:
```ts
const dataToSign = `${data}:${unixTime}`;
```

The FMD server's `commandData` struct comment at
`/Users/tschnurre/external-GIT/fmd-server/backend/apiv1.go:44` is
explicit:
```go
CmdSig string // base64-encoded signature over "UnixTime:Data"
```

The Android client (`FmdServerApiV1Repository.kt:594`) verifies the
signature on the receive side as:
```kotlin
CypherUtils.verifySig(publicKeyPem, "$time:$command", sig)
```

Both confirm the signed string is `${UnixTime}:${Data}`, with the
timestamp first. The adapter has the two in the wrong order.

The bug was latent until the previous change `fix-auth-bug` made
`FmdAuth.authenticate()` succeed for the first time. With a working
access token, the ring dispatch path
(`onStateChange → triggerRing → FmdApi.sendRingCommand`) actually
fires the HTTP request. The FMD server's `postCommand` handler
(`apiv1.go:339`) does **not** verify the signature on the write
side — it only validates the access token via
`CheckAccessTokenAndGetUser`, then calls
`SetCommandToUser(user, data.Data, data.UnixTime, data.CmdSig)`
which stores the three values verbatim. The server then pushes the
pending command to the device. The device app's `getCommand` handler
returns the stored `Data`, `UnixTime`, `CmdSig` to the device, which
runs `verifySig(publicKey, "$time:$command", sig)` — and **fails
silently** because the signature does not match the message the
client built.

Net effect: the adapter logs `Ring command sent to device: <id>`,
the server returns 200, and the phone does nothing.

Adjacent issue: the `importKey` and `sign` calls use
`{ name: "RSA-PSS", hash: "SHA-256" }` and
`{ name: "RSA-PSS", saltLength: 32 }`. The PSS salt length of 32
matches the Android verifier's `PSSParameterSpec("SHA-256", "MGF1",
MGF1ParameterSpec.SHA256, 32, 1)` (the `32` is the salt length, the
`1` is the trailer field). The hash and salt length are correct, but
the spec should pin both explicitly so a future Node version that
changes the default (or a future FMD server that picks a different
PSS profile) does not silently desync.

## Goals / Non-Goals

**Goals**

- Flip the signed payload in `FmdApi.signRequest` to
  `${UnixTime}:${Data}` so the signature matches what the FMD
  server documents and what the device app verifies.
- Pin the PSS parameters in the `crypto.subtle` calls so the
  algorithm is explicit, not implicit.
- Add a debug log line in `sendRingCommand` that prints the
  signed-string length and the first 8 chars of the base64 signature
  (debug level only), so a future signing-bug can be diagnosed
  without re-reading the source.
- Add `scripts/ring-smoke.mjs` so the signing fix can be verified
  end-to-end against a real FMD server from the dev host, without
  Docker. The script posts a `ring:<id>` and reports whether the
  server accepted it (HTTP 200) or rejected it.
- The Admin-UI's `info.lastError` and Connection Status panel
  continue to show a useful error if signing fails for any reason
  (PEM parse, `crypto.subtle` throws, etc.).

**Non-Goals**

- Replacing `crypto.subtle` with a third-party RSA library
  (`node-rsa`, `node-forge`, etc.). `crypto.subtle` works.
- Adding automatic re-sign / retry on signature failures. The
  `FmdApi` call is one-shot.
- Changing the request body shape, the endpoint, the headers, or
  the public method signatures of `FmdApi`. They are correct.
- Touching `FmdAuth`, `main.ts`, `io-package.json`, the Admin-UI, or
  the deployment workflow. The fix is two strings and one log line.
- Caching the access token across `sendRingCommand` invocations. The
  existing in-memory `authTokens` field is fine for this change.
- Supporting older or non-standard FMD servers. We target v0.14.0
  of the FMD server, same as the previous change.

## Decisions

### D1. Flip the signed payload to `${UnixTime}:${Data}`

- **Decision:** Change `dataToSign` from `${data}:${unixTime}` to
  `${unixTime}:${data}`. Single line. Add a comment block citing
  the FMD server source location (`backend/apiv1.go:44`) and the
  Android client source location
  (`FmdServerApiV1Repository.kt:594`).
- **Why:** Two independent confirmations of the order. There is no
  other plausible interpretation. The 1-character flip is the
  entire bug.
- **Why not also flip the request body field order:** the body
  fields (`Data`, `UnixTime`, `CmdSig`) are JSON-decoded into
  Go field names by `json.Decoder`, not parsed by position. The
  order in the JSON object is irrelevant to the server.

### D2. Pin the PSS parameters explicitly

- **Decision:** Make the `importKey` and `sign` algorithm
  descriptors self-documenting:
  ```ts
  const key = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["sign"],
  );
  const signature = await crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 32 },
      key,
      dataBytes,
  );
  ```
  These are already the values being used (verified by reading
  the current code). The change is a comment + an explicit
  `// match Android verifier: PSSParameterSpec("SHA-256", "MGF1",
  // MGF1ParameterSpec.SHA256, 32, 1)` note pointing at
  `CypherUtils.java:326`.
- **Why:** PSS has more parameters than the four the code uses
  (hash, MGF, MGF hash, salt length, trailer). The Android verifier
  uses MGF1 with SHA-256. WebCrypto's defaults for `RSA-PSS` are
  MGF1 with the same hash. The defaults happen to match, but the
  spec should not depend on defaults staying unchanged.
- **Why not also pin the MGF1 hash explicitly:** WebCrypto's
  `crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 })` does
  not expose a parameter to override the MGF1 hash. The only way
  to pin it would be to switch to a different library
  (`node-forge`, `node-rsa`, hand-rolled OpenSSL via `crypto`).
  Not worth it for a value that is identical between the
  implementations we care about.

### D3. Build the signed string once, in `sendRingCommand`

- **Decision:** Build the signed string at the call site
  (`sendRingCommand`), pass it to `signRequest` as a single
  `payload: string` parameter. `signRequest` no longer takes
  `data` and `unixTime` separately; it signs whatever bytes it is
  handed.
- **Why:** keeps the format string in one place. If a future
  request needs to sign additional context (e.g. a server-provided
  nonce in the FMD v0.15 protocol), the change is at the call
  site, not in a method that knows how to format the message.
- **Why not a separate `formatSignedPayload(data, unixTime)`
  helper:** YAGNI. There is exactly one call site.

### D4. Debug log line: signed-string length and signature head

- **Decision:** In `sendRingCommand`, after `signRequest` returns,
  log at `debug`:
  ```
  ring: signed payload length=24 sig=<first 8 chars of base64>...
  ```
  The signature base64 is 344 chars for a 2048-bit RSA key; the
  first 8 chars are enough to confirm shape (proper Base64,
  correct length) without leaking the whole signature.
- **Why:** when the next signing-bug lands (and there will be
  one), the developer wants to see "the payload is 24 chars
  (19-char `ring:<id>` + 1 colon + 4-digit year, looks right), the
  signature is 344 chars (right for 2048-bit RSA), the first 8
  chars are `AbCdEfGh` (looks like Base64)" — that is enough to
  rule out a formatting or truncation problem without
  re-running the code.
- **Why only the first 8 chars of the signature:** a signature is
  not a secret (the public key is in the FMD user's profile), but
  logging the whole 344 chars would be visual noise. 8 chars is
  enough to spot a non-Base64 character or a wrong length.

### D5. `scripts/ring-smoke.mjs`

- **Decision:** Ship a Node ESM script that takes the auth inputs
  via environment variables (same set as `auth-smoke.mjs` from the
  previous change: `FMD_SERVER_URL`, `FMD_USERNAME`,
  `FMD_PASSWORD`) plus `FMD_DEVICE_ID` (which device to ring).
  Runs the full auth flow, then `FmdApi.sendRingCommand(<id>)`.
  Exits 0 if the FMD server returns HTTP 200, 1 on any other
  response, 2 on missing env, 3 on a thrown error.
- **Why:** today there is no way to verify the ring path without
  starting ioBroker, clicking the Shelly button, hoping the device
  app is reachable, hoping the user can hear the ring. A script
  that just checks "did the server accept the signed payload" is
  the first sanity check.
- **Why ESM, why in `scripts/`:** same as `auth-smoke.mjs` from
  the previous change. The repo is not `"type": "module"`, so
  `.mjs` extension is the cheapest way to opt in.
- **Why not also fetch the device's `GET /command` response and
  re-verify the signature locally:** that requires knowing the
  device's public key (returned by `GET /pubKey`, requires
  authenticated request) and re-implementing the PSS verify in
  Node. Out of scope. The smoke script confirms the **server
  accepted the request**, which is the adapter's only contract.

### D6. Logging policy: no full signature in logs

- **Decision:** Debug logs include signed-payload length, signature
  length, and the first 8 chars of the base64 signature. Never the
  full signature, never the private key, never the access token at
  any level.
- **Why:** a signature is not a secret in the cryptographic sense,
  but it is sensitive in the operational sense (it can be used for
  replay within the FMD server's window — see the Android client's
  "strictly increasing timestamp" check). 8 chars is enough for
  diagnostics.

## Risks / Trade-offs

- **[Wrong-direction flip]** The single most likely failure mode of
  this change is misreading the FMD source and flipping the wrong
  way (e.g. moving to `${Data}:${UnixTime}` because that is what
  the adapter already does). → **Mitigation:** the design cites
  two independent source locations (server struct comment and
  Android client verify call). The smoke script catches a wrong
  flip at the network boundary: if the FMD server returns 200, the
  signature was at least structurally valid for the server; if the
  device app still ignores the command, the smoke script is
  inconclusive but the user-visible behaviour matches the previous
  change's auth-bug fix path (verify by hand on the phone).
- **[PSS parameter drift in Node 22]** If a future Node version
  changes the default MGF1 hash for `RSA-PSS` from SHA-256 to
  something else, the signature will desync with the Android
  verifier. → **Mitigation:** WebCrypto's PSS implementation pins
  the MGF1 hash to the algorithm's named hash (per W3C WebCrypto
  spec), so the only way it can change is a major Node change.
  Pinning the explicit `saltLength: 32` and the comment pointing
  at the Android verifier is enough; a runtime check (sign and
  verify against a known key pair in the smoke script) would be
  belt-and-braces but is deferred.
- **[Replay window]** The current code calls `Date.now()` at the
  adapter side. If the device app's "strictly increasing timestamp"
  check is too strict (e.g. requires a monotonic counter, not wall
  clock), a ring command sent at 23:59:59.999 and another at
  00:00:00.001 will be rejected as out-of-order. → **Mitigation:**
  this is a server/app policy, not an adapter issue. If it
  manifests, the adapter can pass an explicit `unixTime` to
  `sendRingCommand` (e.g. a monotonic counter). Out of scope for
  this change.
- **[The fix is invisible without a real device]** The server
  accepts the request with the wrong signature, so the unit-level
  check ("did the server return 200?") is a weak signal. The real
  verification is the device app actually ringing. → **Mitigation:**
  the smoke script reports the 200 and the user can manually
  confirm the ring on the phone. The design avoids claiming the
  smoke script is a full proof; it is a "the server did not 4xx
  us" check.

## Migration Plan

1. Land the change on `main` behind the normal `git push` flow.
   `build/main.js` must be rebuilt (`npm run build:tsc`) and
   committed because the container reads the compiled JS, not
   `src/`. No `npm run build:admin` is needed (no Admin-UI
   changes).
2. Run the deployment workflow in `CLAUDE.md`:
   `docker compose up -d` → `iobroker url <repo>` → workdir fix →
   `iobroker upload iobroker-fmd` → `iobroker restart iobroker-fmd.0`.
3. **Before the Docker step**, the developer runs
   `FMD_SERVER_URL=https://fmd.schnurri.ch FMD_USERNAME=eLZo3
   FMD_PASSWORD=<…> FMD_DEVICE_ID=<id> node scripts/ring-smoke.mjs`.
   The script prints `OK server accepted ring command` and exits 0
   on success. Exit code 1 means the server rejected (auth or
   signing problem); exit code 3 means the script itself threw.
4. After the adapter restart, `docker exec iobroker-fmd-dev
   iobroker logs iobroker-fmd --files=15` shows
   `Ring command sent to device: <id>`. The user manually verifies
   the phone rings within ~5 s of the Shelly button triple-push (or
   the manual `setState 0_userdata.0.FindMyDevice.ring.<id> true`).
5. If the phone does not ring, the device app's debug log (if
   enabled) shows `Failed to verify the signature of command
   'ring:<id>'` — that means the FMD Android app version on the
   phone is checking a different signature format than the FMD
   server we target. Out of scope for this change; would be a
   server / app version mismatch.

**Rollback:** revert the commit. The previous (broken) signing code
is self-contained in `lib/fmd-api.ts`; reverting the file restores
the `${Data}:${UnixTime}` order. The `scripts/ring-smoke.mjs` is
additive and does not need to be removed for the adapter to function.

## Open Questions

- **Does the FMD server's `postCommand` perform any signature
  verification at all?** Reading `apiv1.go:339-353`, the answer is
  no — it only validates the access token. So the only signature
  check is on the device side, and a server-level smoke test can
  only confirm "the request was accepted", not "the signature was
  correct". A real verification requires a device on hand. The
  smoke script is honest about this.
- **What timestamp units does the FMD server expect?** The
  `commandData.UnixTime` field is `uint64`, and the comment says
  "unix time in milliseconds". The Android client reads it as a
  `Long`. The current adapter passes `Date.now()`, which is
  milliseconds since epoch. Confirmed correct, but a future
  reviewer should know that swapping to `Date.now() / 1000` would
  silently break the device app's "strictly increasing" check.
- **Should the smoke script also accept a `--verify` flag that
  fetches the device's public key and re-verifies the signature
  locally?** Useful but out of scope. The script's job is "did the
  server accept the request", which is the adapter's only
  contract.
