## Why

The previous change `fix-ring-signing` (archived 2026-06-08) fixed
the FMD server's silently-accepted-but-wrong signature by flipping
`${data}:${unixTime}` to `${unixTime}:${data}` and by adding comments
pinning the PSS parameters (hash, MGF1, salt length, trailer). Those
comments are documentation only — the code still relies on WebCrypto
defaults for the MGF1 hash and the trailer field, because
`crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 })` exposes
neither parameter for override.

That is fragile in two ways:

1. **Future Node-version drift.** WebCrypto's `RSA-PSS` algorithm
   currently pins the MGF1 hash to the named algorithm hash (SHA-256)
   per the W3C spec. A future Node major could plausibly change that
   default. The only thing standing between us and a silent
   re-break of the device-app's `verifySig` is a spec line we do
   not own.
2. **No local verification possible.** Today, the smoke script can
   only confirm "the FMD server returned 200". It cannot locally
   sign-then-verify against a known key pair, because the only RSA
   implementation we have is WebCrypto and a 2048-bit PSS
   sign+verify round-trip is not part of the same code path we use
   to sign outgoing requests. A self-test that proves "what we
   sign is what the Android verifier would accept" requires a
   library where we can both sign and verify with explicit PSS
   parameters.

The change pins the PSS parameters by switching the signing
implementation from `crypto.subtle` to **`node-forge`**, which
exposes a full `pki.sign` with a `pss` option object that names
hash, MGF hash, and salt length. node-forge is a pure-JS library
(zero native deps, no postinstall compile step), it ships its own
ASN.1 / PEM / PKCS#8 parser, and its RSA-PSS implementation is
battle-tested against BoringSSL, OpenSSL, and the Java
`RSASSA-PSS` verifier we target on the Android side.

## What Changes

- **Replace the signing backend in `FmdApi.signRequest`.** The
  helper SHALL use `node-forge.pki` (private key import via
  `pki.privateKeyFromAsn1` against a base64-decoded PKCS#8
  DER — the storage format FMD already uses), build a PSS
  profile via `forge.pss.create(md, mgf, saltLength)` with
  `md = forge.md.sha256.create()`,
  `mgf = forge.mgf.mgf1.create(forge.md.sha256.create())`,
  and `saltLength = 32`, and sign via
  `privateKey.sign(messageDigest, pss)`. The matching verify
  call is `publicKey.verify(digestBytes, signature, pss)`.
  SHA-256, MGF1 with SHA-256, salt length 32, trailer
  field 1 — all explicit, no library default depended on.
- **Keep the public method signatures stable.**
  `FmdApi.sendRingCommand(deviceId)` and
  `FmdAuth.authenticate()` keep their exact signatures. The
  private `signRequest` helper keeps its single-string
  `payload` parameter (Decision D3 from the previous change).
- **Add a self-test path in the smoke script.** Extend
  `scripts/ring-smoke.mjs` with a `--verify` mode (and a new
  `npm run ring:smoke:verify` script entry) that, given a
  locally-generated 2048-bit RSA key pair, signs a fixed
  payload with the same `signRequest` path the adapter uses,
  then verifies the signature locally with
  `publicKey.verify(digestBytes, signature, pss)` and the
  matching PSS options. Exit 0 only if sign-then-verify
  round-trips. This is the first time the repo has a
  programmatic check that the adapter's signed output is
  verifiable with the same parameters the device app uses.
- **Add `node-forge` to `dependencies`.** Pinned to a current
  1.x release (^1.3.1). It is pure-JS, no native compilation,
  no `node-gyp` postinstall — verified at design time.
- **No** change to `FmdAuth`, `main.ts`, `io-package.json`, the
  Admin-UI, the deployment workflow, the auth flow, or the
  signed-payload format (`${unixTime}:${ring:<id>}` stays
  correct — that is the bug the previous change already fixed,
  and the FMD server source + Android client source confirm
  it).
- **No** change to the FMD server contract. The
  `POST /api/v1/command` body, the `IDT` / `CmdSig` headers,
  and the accepted key format on the server side are
  unchanged.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `fmd-ring-signing`: A new requirement clause SHALL be added:
  the signing implementation MUST pin all four PSS parameters
  (hash, MGF hash, salt length, trailer) explicitly — not by
  relying on library defaults. The current requirement, set
  by the previous change, says "matches the Android verifier's
  PSSParameterSpec(SHA-256, MGF1, SHA-256, 32, 1) via WebCrypto
  defaults". The followup changes "via WebCrypto defaults" to
  "explicitly, via `node-forge`'s pss option object" because
  WebCrypto does not expose a knob for the MGF1 hash. A delta
  spec at `specs/fmd-ring-signing/spec.md` captures this.

## Impact

- **`src/lib/fmd-api.ts`:** rewrite the body of the private
  `signRequest` method (currently lines 133-176). Build a
  PKCS#8 ASN.1 object via
  `forge.asn1.fromDer(derBytes)`, hand it to
  `forge.pki.privateKeyFromAsn1(derAsn1)`, build a PSS profile
  via `forge.pss.create(md, mgf, saltLength)` with explicit
  SHA-256 / MGF1-SHA-256 / 32-byte salt, and sign via
  `privateKey.sign(messageDigest, pss)`. The caller
  (`sendRingCommand`), the `base64ToBytes` helper, the public
  API surface, and the rest of the file are unchanged.
- **`package.json`:** add `"node-forge": "^1.3.1"` to
  `dependencies`. No `devDependencies` change (no new tool
  needed). No new `optionalDependencies`. Bundle size impact
  is the only real cost (see design.md risks).
- **`scripts/ring-smoke.mjs`:** extend with a `--verify` mode
  and a local round-trip self-test. Existing usage
  (`FMD_SERVER_URL=… FMD_USERNAME=… FMD_PASSWORD=… FMD_DEVICE_ID=…
  node scripts/ring-smoke.mjs`) is preserved.
- **`package.json` scripts:** add `ring:smoke:verify` as an
  alias for `node scripts/ring-smoke.mjs --verify`. Keep
  `ring:smoke` as the live-server entry, unchanged.
- **No** change to `src/main.ts`, `src/lib/fmd-auth.ts`,
  `io-package.json`, the Admin-UI, the deployment workflow,
  the docs, or any other previously-archived change.
- **No** new build step. `tsc` already compiles the import;
  `node-forge` ships its own TypeScript types in
  `@types/node-forge` (add to `devDependencies` for
  `import`-time type checking).
