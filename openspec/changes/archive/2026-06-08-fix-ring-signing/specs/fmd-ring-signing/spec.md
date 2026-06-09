## ADDED Requirements

### Requirement: Ring commands are signed over `UnixTime:Data`
The adapter SHALL sign the string `${unixTime}:${data}` (Unix
milliseconds, a literal ASCII colon, then the command string) when
building the `CmdSig` header for the FMD server's `commandData`
body. The adapter SHALL NOT sign `${data}:${unixTime}`.

The concatenation is performed in `FmdApi.sendRingCommand` and
passed as a single byte buffer to `crypto.subtle.sign`. The signed
string is built exactly once per request; there is no other
location in the source that formats the same string.

#### Scenario: Sign a ring command with the correct order
- **WHEN** `FmdApi.sendRingCommand("eLZo3")` is invoked at
  `unixTime = 1717856400000`
- **THEN** the `dataToSign` string is exactly
  `"1717856400000:ring:eLZo3"` (length 24)
- **AND** `crypto.subtle.sign` is called with those bytes
- **AND** the resulting base64 signature is placed in the `CmdSig`
  header

#### Scenario: Sign a different command
- **WHEN** the adapter ever sends a non-`ring:` command (e.g.
  `"lock:eLZo3"`, `"locate:eLZo3"`) — a future feature, not
  shipped today
- **THEN** the same `${unixTime}:${data}` rule applies
- **AND** the command string is unchanged (no added prefix,
  suffix, or escape)

#### Scenario: No `Data:UnixTime` order remains
- **WHEN** the adapter source is grep'd for `${data}:` and
  `${unixTime}:` template literals
- **THEN** zero matches for the reverse-order concatenation remain
  in `lib/fmd-api.ts`

### Requirement: RSA-PSS parameters are pinned to SHA-256 / MGF1 / salt 32
The `crypto.subtle.importKey` call in `FmdApi.signRequest` SHALL
declare `{ name: "RSA-PSS", hash: "SHA-256" }` and the
`crypto.subtle.sign` call SHALL declare
`{ name: "RSA-PSS", saltLength: 32 }`. These values match the FMD
Android client's `PSSParameterSpec("SHA-256", "MGF1",
MGF1ParameterSpec.SHA256, 32, 1)` verifier and SHALL be commented
in the source as such.

#### Scenario: Hash and salt length are explicit
- **WHEN** `FmdApi.signRequest` runs
- **THEN** the `importKey` algorithm spec contains `hash: "SHA-256"`
- **AND** the `sign` algorithm spec contains `saltLength: 32`
- **AND** a comment in the source points at the Android verifier
  location for cross-reference

#### Scenario: PSS default changes do not silently desync
- **WHEN** a future Node version changes the default MGF1 hash for
  `RSA-PSS` (hypothetical; the WebCrypto spec pins it to the
  algorithm's named hash)
- **THEN** the smoke script's `OK server accepted ring command`
  output is the first line of defence (the server accepts the
  signature, so the device-side verify should also pass)
- **AND** the failure mode in the device app is "ring ignored",
  not a server 4xx, so the existing `info.lastError` panel does
  not surface a useful message (acknowledged limitation)

### Requirement: Signing failures surface to the user via `info.lastError`
The `FmdApi.sendRingCommand` method SHALL wrap `signRequest` in a
try/catch and, on failure, set `info.lastError` to the thrown
message. The existing `FmdApi` method already throws on failure,
and `main.ts.triggerRing` already catches the throw and logs it;
this requirement makes the surface contract explicit so a future
refactor cannot regress it.

#### Scenario: `crypto.subtle.importKey` throws on a malformed PEM
- **WHEN** the access token's `privateKey` is not a valid PKCS#8
  PEM (e.g. the FMD server returned a different format, the
  storage was corrupted)
- **THEN** `crypto.subtle.importKey` throws
- **AND** the throw propagates to `FmdApi.sendRingCommand`
- **AND** `FmdApi.sendRingCommand` logs the error and rethrows
- **AND** `main.ts.triggerRing` catches the throw and sets
  `info.lastError` to the message

#### Scenario: `crypto.subtle.sign` throws on an unsupported key size
- **WHEN** the access token's `privateKey` is a valid PEM but the
  key size is not supported by the runtime (e.g. 1024-bit key on
  a Node version that requires ≥ 2048)
- **THEN** `crypto.subtle.sign` throws
- **AND** the throw propagates to `info.lastError` as above

### Requirement: The signed payload is built once, in `sendRingCommand`
The `FmdApi.signRequest` method SHALL accept a single
`payload: string` parameter (the exact bytes to sign) and SHALL
NOT re-derive the payload from `data` and `unixTime`. The
concatenation template lives at the call site in
`sendRingCommand`, not in the signing helper.

#### Scenario: `signRequest` is a pure bytes-to-signature helper
- **WHEN** the adapter source is read
- **THEN** `signRequest(payload: string)` is the method signature
- **AND** there is no `signRequest(data: string, unixTime: number)`
  signature or any other overload
- **AND** the `${payload}` template literal is the only format
  string in the file

#### Scenario: A future change to the payload format is local
- **WHEN** a future FMD protocol version requires signing a
  different string (e.g. a server-provided nonce, a hash of the
  body)
- **THEN** the change is a single edit in `sendRingCommand`
- **AND** `signRequest` is unchanged

### Requirement: Debug log line confirms the signed payload shape
The `FmdApi.sendRingCommand` method SHALL, on the `debug` log
level, emit a single line with the signed-payload length, the
signature length, and the first 8 characters of the base64
signature, immediately after `signRequest` returns. The full
signature SHALL NOT be logged at any level.

#### Scenario: Debug log line on success
- **WHEN** `FmdApi.sendRingCommand` succeeds and the adapter's
  log level is `debug`
- **THEN** the adapter log contains a line whose message includes
  the substring `ring: signed payload length=` followed by the
  payload length
- **AND** the substring `sig=` followed by exactly 8 characters of
  base64 (then `...`)
- **AND** the full 344-character signature is not present in any
  log line

#### Scenario: Debug log line absent on `info` level
- **WHEN** the adapter's log level is `info` (the default)
- **THEN** the debug log line is not emitted (it is conditional on
  `log.debug`, which is a no-op at `info`)

### Requirement: The ring signing flow is verifiable outside the Docker container
A developer SHALL be able to verify the ring signing fix from the
dev host (macOS, Node 22) without starting the ioBroker container.
The verification uses `scripts/ring-smoke.mjs`, an ESM Node script
that reads `FMD_SERVER_URL`, `FMD_USERNAME`, `FMD_PASSWORD`, and
`FMD_DEVICE_ID` from `process.env` and posts a `ring:<id>` to the
FMD server using the same `FmdApi` code path as the adapter.

#### Scenario: Smoke script accepts a real FMD server
- **WHEN** the developer runs
  `FMD_SERVER_URL=https://fmd.example.com FMD_USERNAME=u
   FMD_PASSWORD=p FMD_DEVICE_ID=<id> node scripts/ring-smoke.mjs`
  with valid credentials
- **THEN** the script exits with code 0
- **AND** prints `OK server accepted ring command`

#### Scenario: Smoke script detects a wrong signature
- **WHEN** the FMD server rejects the request with a 4xx (e.g.
  because the signing bug is back)
- **THEN** the script exits with code 1
- **AND** prints the FMD server's error body for debugging

#### Scenario: Smoke script handles missing env
- **WHEN** any of `FMD_SERVER_URL`, `FMD_USERNAME`, `FMD_PASSWORD`,
  `FMD_DEVICE_ID` is unset
- **THEN** the script exits with code 2
- **AND** prints the name of the first missing variable

#### Scenario: Smoke script handles a thrown error
- **WHEN** the `FmdApi.sendRingCommand` call throws (e.g. the
  auth flow failed, the server is unreachable, the PEM is
  malformed)
- **THEN** the script exits with code 3
- **AND** prints the error message
