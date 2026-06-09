# Capability: fmd-ring-signing (delta)

## MODIFIED Requirements

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

## ADDED Requirements

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
