# Capability: fmd-ring-signing

## Purpose

Define how the adapter signs ring commands before sending them to the
FMD server, so that the device app's signature verifier accepts the
command and rings the phone.

## Requirements

### Requirement: Ring commands are signed over `UnixTime:Command`
The adapter SHALL sign the string `${unixTime}:${data}` (Unix
milliseconds, a literal ASCII colon, then the command string) when
building the `CmdSig` header for the FMD server's `commandData`
body. The adapter SHALL NOT sign `${data}:${unixTime}`.

The command string is the FMD Android client's command keyword —
**`"ring"`** — NOT `"ring:<deviceId>"`. The device is implicit in
the access-token-owner: the FMD server routes the command to the
device that owns the access token used to authenticate the
request, and the Android client's
`ServerCommandDownloader.onResponse` (see
`ServerCommandDownloader.kt:73-75`) prepends the user's
configured trigger word to the received command before parsing
it against `RingCommand.keyword = "ring"` (see `RingCommand.kt:19`).
Sending `"ring:<deviceId>"` would make the second token
`"ring:<deviceId>"` after trigger-word splitting, which matches
no registered command and is silently dropped. The `${data}`
template therefore carries only the command keyword, never the
device ID.

The concatenation is performed in `FmdApi.sendRingCommand` and
passed as a single byte buffer to the `signRequest` helper (a
`node-forge`-backed function — see the PSS-requirements section
below). The signed string is built exactly once per request;
there is no other location in the source that formats the same
string.

#### Scenario: Sign a ring command with the correct order
- **WHEN** `FmdApi.sendRingCommand("eLZo3")` is invoked at
  `unixTime = 1717856400000`
- **THEN** the `dataToSign` string is exactly
  `"1717856400000:ring"` (length 18, with the command keyword
  `"ring"` and no device-ID suffix)
- **AND** the `signRequest` helper (the `node-forge`-backed
  PSS signer) is called with those bytes
- **AND** the resulting base64 signature is placed in the `CmdSig`
  header

#### Scenario: Sign a different command
- **WHEN** the adapter ever sends a non-`ring` command (e.g.
  `"lock"`, `"locate"`) — a future feature, not shipped today
- **THEN** the same `${unixTime}:${data}` rule applies
- **AND** the command string is the FMD command keyword only
  (no device ID, no added prefix, suffix, or escape)

#### Scenario: No `Data:UnixTime` order remains
- **WHEN** the adapter source is grep'd for `${data}:` and
  `${unixTime}:` template literals
- **THEN** zero matches for the reverse-order concatenation remain
  in `lib/fmd-api.ts`

### Requirement: RSA-PSS parameters are pinned to SHA-256 / MGF1 / salt 32 / trailer 1
The signing implementation in `FmdApi.signRequest` SHALL set all
four RSA-PSS parameters explicitly — hash, MGF1 hash, salt length,
trailer field — by name, with no parameter falling through to a
library default. The values SHALL be:

- hash: **SHA-256** (the OID for the message digest)
- MGF1 hash: **SHA-256** (the OID used inside the mask-generation
  function)
- salt length: **32 bytes** (the SHA-256 output size, the FMD
  protocol choice)
- trailer field: **1** (modern PSS, the only trailer the
  PKCS#1 v2.1 spec defines)

The implementation SHALL achieve this with a library that exposes
all four knobs. The implementation SHALL NOT use `crypto.subtle`'s
`{ name: "RSA-PSS", saltLength: 32 }` shape, because
`crypto.subtle.sign` does not expose a parameter to override the
MGF1 hash (WebCrypto pins it implicitly to the algorithm's named
hash per the W3C spec, and that pinning is not part of the
public WebCrypto contract — a future Node version or a future
FMD verifier choice would not be caught by a unit test).

The chosen library SHALL be `node-forge`. The signing call
SHALL build a PSS profile via
`forge.pss.create(md, mgf, saltLength)` — the **positional**
form, not an options object — and pass it to
`privateKey.sign(messageDigest, pss)` /
`publicKey.verify(digestBytes, signature, pss)`. The PSS
profile's `md` SHALL be `forge.md.sha256.create()`, the
`mgf` SHALL be
`forge.mgf.mgf1.create(forge.md.sha256.create())`, and the
`saltLength` SHALL be `32`. The trailer field SHALL be left
at its modern PSS default of `1` (the only trailer
`PKCS#1 v2.1` defines). The private key SHALL be loaded from
the existing base64-encoded PKCS#8 DER storage (the format
FMD already returns from `AccessKeyData`) via
`forge.asn1.fromDer(forge.util.createBuffer(forge.util.decode64(base64)))`
followed by `forge.pki.privateKeyFromAsn1(asn1)`. A synthetic
PEM envelope is not required.

The signing code SHALL keep a single inline comment that points
at the FMD Android client's `PSSParameterSpec("SHA-256", "MGF1",
MGF1ParameterSpec.SHA256, 32, 1)` at
`CypherUtils.java:325-326` as the canonical source of the four
parameters.

#### Scenario: All four PSS parameters are set explicitly
- **WHEN** `FmdApi.signRequest` runs against any private key
  (real FMD key, dev test key, or a freshly generated 2048-bit
  pair)
- **THEN** the PSS profile is built via
  `forge.pss.create(md, mgf, saltLength)` with
  `md = forge.md.sha256.create()`,
  `mgf = forge.mgf.mgf1.create(forge.md.sha256.create())`,
  and `saltLength = 32`
- **AND** `privateKey.sign(messageDigest, pss)` is invoked
  with that PSS profile and a SHA-256 `MessageDigest` of the
  payload as the first argument
- **AND** a comment in the source points at the Android verifier
  location for cross-reference

#### Scenario: Round-trip sign-then-verify succeeds with the same PSS options
- **WHEN** the smoke script runs in `--verify` mode (a local
  sign-then-verify round-trip on a freshly generated 2048-bit
  RSA key pair, no network)
- **THEN** the `publicKey.verify(digestBytes, signature, pss)`
  verifier is constructed with a PSS profile whose `md`,
  `mgf`, and `saltLength` match the signer's exactly
- **AND** the verifier returns `true` for the signature produced
  by the same `signRequest` code path
- **AND** the script exits with code 0

#### Scenario: A future FMD verifier that picks a different PSS profile fails loudly
- **WHEN** the FMD Android client at some point changes its PSS
  profile (hypothetical — the values SHA-256 / MGF1 / SHA-256 /
  32 / 1 are stable as of FMD server 0.14.0 and FMD Android
  0.14.x)
- **THEN** the developer can update only the four constants in
  `FmdApi.signRequest` and the `scripts/ring-smoke.mjs`
  `--verify` round-trip
- **AND** the change does not require a dependency change

#### Scenario: PSS default changes do not silently desync
- **WHEN** a future `node-forge` version changes a PSS default
  (hypothetical)
- **THEN** the round-trip self-test (`scripts/ring-smoke.mjs
  --verify`) catches the desync at developer-build time, before
  the change ships
- **AND** the live-server smoke (`scripts/ring-smoke.mjs`
  without `--verify`) still confirms "the FMD server accepted
  the request" as a second line of defence

### Requirement: The signing output is locally verifiable with the same PSS options
The smoke script `scripts/ring-smoke.mjs` SHALL support a
`--verify` mode that performs a sign-then-verify round-trip on
a locally generated 2048-bit RSA key pair, using the same
`signRequest` code path the adapter uses for live ring
commands, and verifies the result with
`publicKey.verify(digestBytes, signature, pss)` where `pss`
is built via `forge.pss.create(md, mgf, saltLength)` with the
same `md`, `mgf`, and `saltLength` as the signer. The mode
SHALL exist to give the developer a programmatic check that
what the adapter signs is what the FMD Android verifier
would accept, without needing a phone in hand.

The round-trip SHALL run entirely offline (no `FMD_SERVER_URL`
required for `--verify`), so the developer can run it on a
fresh checkout with zero credentials.

#### Scenario: `--verify` exits 0 on a clean round-trip
- **WHEN** the developer runs `node scripts/ring-smoke.mjs
  --verify` from the repo root
- **THEN** the script generates a 2048-bit RSA key pair via
  `forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })`
- **AND** calls `signRequest(payload)` with a fixed test
  payload (e.g. `1700000000000:ring:test-device`)
- **AND** calls `publicKey.verify(digestBytes, signature, pss)`
  against the matching public key
- **AND** the verifier returns `true`
- **AND** the script prints `OK sign-then-verify round-trip`
  and exits with code 0

#### Scenario: `--verify` exits non-zero on a forced desync
- **WHEN** the developer temporarily flips the MGF1 hash
  inside the `forge.pss.create(...)` call in `signRequest`
  (a manual test mutation, not committed) to a different
  digest (e.g. `forge.md.sha512.create()`)
- **THEN** the round-trip fails: the verifier returns `false`
  or throws a PSS decoding error
- **AND** the script prints the failed-verify body
- **AND** exits with code 1

#### Scenario: `--verify` does not require credentials
- **WHEN** the developer runs `node scripts/ring-smoke.mjs
  --verify` with no `FMD_SERVER_URL`, `FMD_USERNAME`,
  `FMD_PASSWORD`, or `FMD_DEVICE_ID` in the environment
- **THEN** the script does not read or check those variables
- **AND** runs the local round-trip as above
- **AND** exits with code 0 on success

#### Scenario: The default mode (no `--verify`) is unchanged
- **WHEN** the developer runs `node scripts/ring-smoke.mjs`
  without `--verify` and with all four env vars set
- **THEN** the behaviour matches the previous change's smoke
  script: it calls the live FMD server, prints
  `OK server accepted ring command` on HTTP 200, exits 1 on
  4xx/5xx, exits 2 on missing env, exits 3 on a thrown error
- **AND** no local key generation or round-trip runs

### Requirement: Signing failures surface to the user via `info.lastError`
The `FmdApi.sendRingCommand` method SHALL wrap `signRequest` in a
try/catch and, on failure, set `info.lastError` to the thrown
message. The existing `FmdApi` method already throws on failure,
and `main.ts.triggerRing` already catches the throw and logs it;
this requirement makes the surface contract explicit so a future
refactor cannot regress it.

#### Scenario: PKCS#8 DER parse throws on a malformed private key
- **WHEN** the access token's `privateKey` is not a valid PKCS#8
  DER (e.g. the FMD server returned a different format, the
  storage was corrupted)
- **THEN** the `node-forge` parse path
  (`forge.asn1.fromDer(forge.util.createBuffer(forge.util.decode64(base64)))`
  followed by `forge.pki.privateKeyFromAsn1(asn1)`) throws
- **AND** the throw propagates to `FmdApi.sendRingCommand`
- **AND** `FmdApi.sendRingCommand` logs the error and rethrows
- **AND** `main.ts.triggerRing` catches the throw and sets
  `info.lastError` to the message

#### Scenario: `privateKey.sign` throws on an unsupported key size
- **WHEN** the access token's `privateKey` is a valid PKCS#8 DER
  but the key size is not supported by `node-forge`'s RSA
  implementation (e.g. a 1024-bit key where the PSS profile
  requires ≥ 2048 bits)
- **THEN** `privateKey.sign(messageDigest, pss)` throws
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
`FMD_DEVICE_ID` from `process.env` and posts a `ring` command to
the FMD server using the same `FmdApi` code path as the adapter
(the FMD command keyword is `"ring"` — NOT `"ring:<id>"`, see the
`Ring commands are signed over `UnixTime:Command`` requirement
above).

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

### Requirement: `node-forge` is the only signing library
The project SHALL depend on exactly one RSA-PSS signing
library: `node-forge`. The previous implementation's
`crypto.subtle`-based signing code in `FmdApi.signRequest`
SHALL be replaced and SHALL NOT remain as a fallback or
parallel path. The dependency SHALL be listed in
`package.json` `dependencies` (not `devDependencies`,
because the adapter's compiled `build/main.js` requires it
at runtime).

#### Scenario: Only `node-forge` is imported for signing
- **WHEN** the adapter source is grep'd for `import ` and
  `require(` inside `src/lib/fmd-api.ts`
- **THEN** exactly one import from `node-forge` is present
  (and any number of imports of other modules — `axios`,
  `./fmd-auth`, etc.)
- **AND** `crypto.subtle` and the global `crypto` namespace
  are not referenced anywhere in `FmdApi.signRequest` for
  signing

#### Scenario: `package.json` declares `node-forge` as a runtime dep
- **WHEN** `package.json` is read
- **THEN** `"node-forge": "^1.3.1"` (or a current 1.x
  release) appears under `dependencies`
- **AND** no `"node-forge"` entry under `devDependencies` is
  required (types may live under `devDependencies` as
  `@types/node-forge`)

#### Scenario: `npm install` succeeds without a native build step
- **WHEN** the developer runs `npm install` on a clean
  checkout
- **THEN** `node-forge` installs without requiring
  `node-gyp`, `python`, or a C/C++ toolchain
- **AND** no `optionalDependencies` block is added
- **AND** no postinstall script is added to the project's
  own `package.json`
