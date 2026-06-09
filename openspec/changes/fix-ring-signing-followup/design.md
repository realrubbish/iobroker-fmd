# Design: PSS parameters explicitly pinned via node-forge (followup to fix-ring-signing)

## Context

The previous change `fix-ring-signing` (archived 2026-06-08)
established that the FMD server expects the signed ring payload
to be `${unixTime}:${ring:<deviceId>}` and that the PSS profile
on the verifier (the FMD Android client) is
`PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256,
32, 1)`. The fix flipped the concatenation and added comments
above the existing `crypto.subtle.importKey` /
`crypto.subtle.sign` calls noting which PSS parameter matched
which Android-side value.

The two parameters that *could* be set via WebCrypto — `hash`
on `importKey` and `saltLength` on `sign` — were set
explicitly. The other two — MGF1 hash and trailer field —
were not, because `crypto.subtle.sign({ name: "RSA-PSS",
saltLength: 32 })` does not expose parameters to override them.
WebCrypto happens to pin the MGF1 hash to the algorithm's named
hash (SHA-256) and the trailer to 1, but neither of those is
guaranteed by the WebCrypto contract; both are implementation
defaults. The previous change's design.md (D2, "Why not also
pin the MGF1 hash explicitly") explicitly called this out and
listed `node-forge` as the alternative, then declined it on
YAGNI grounds.

The followup revisits that decision for three reasons:

1. **The PSS-32 change is the kind of thing that is easy to
   break later.** Any future refactor of `signRequest`, any
   future Node-version drift in WebCrypto's PSS defaults, any
   future FMD verifier that picks a different salt length, is
   silent — the server accepts both, the device app's
   `verifySig` returns false, and the user sees the same
   "ring command sent, nothing happens" symptom the previous
   change fixed.
2. **We have no programmatic proof that what we sign is what
   the device app verifies.** The previous change's smoke
   script confirms "the FMD server returned 200", but the
   server does not check the signature on the write side
   (spike 1.4 of the previous change). The only signature
   check is on the device, and we have no way to run that
   check in CI. With `node-forge` we can do a local
   sign-then-verify round-trip on a freshly generated 2048-bit
   key pair, using the same PSS options the device app uses,
   and assert "what the adapter signs is verifiable with the
   same options". This is the first time the repo has a
   test that catches PSS parameter drift at build time.
3. **The bundle-size cost of `node-forge` is finite and
   bounded.** `node-forge` is pure-JS, ships its own
   ASN.1 / PEM / X.509 parser, RSA / PSS / OAEP / PKCS#12
   implementation, and miscellaneous helpers (HMAC, AES,
   etc.). We use ~5% of it. The trade-off is: accept ~600 kB
   of minified JavaScript in the adapter bundle in exchange
   for a PSS implementation that exposes all four knobs and
   that we can also use to verify. The previous change
   treated this as YAGNI; the followup is the first place we
   actually need it.

`node-forge` is the only viable JS-side library. `node-rsa`
exposes PSS sign but not PSS verify with explicit parameters
(it auto-uses Node's `crypto`). `jsrsasign` exposes both but
ships JWS/JWT ballast we do not need and has a worse bundle
profile. Pure WebCrypto with `crypto.subtle.verify` exists,
but the problem we are trying to solve is exactly that we
cannot pin the MGF1 hash in `crypto.subtle.sign`, and the
verifier has the same constraint.

## Goals / Non-Goals

**Goals**

- Pin all four RSA-PSS parameters (hash, MGF1 hash, salt
  length, trailer) by name in the signing code, so no
  parameter falls through to a library default. Match the
  FMD Android verifier's
  `PSSParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256,
  32, 1)`.
- Keep the `FmdApi` public API stable. `sendRingCommand`
  stays one-shot, the request body and headers stay
  byte-identical to the previous change, the
  `${unixTime}:${command}` payload format is preserved.
- Add a local sign-then-verify self-test path in
  `scripts/ring-smoke.mjs` (`--verify` mode) so the
  developer can prove the round-trip is correct without a
  device on hand, without the FMD server, and without
  credentials. The self-test runs entirely offline.
- Add `node-forge` as a runtime dependency
  (`package.json` `dependencies`). Pinned to a current 1.x
  release (`^1.3.1`). It is pure-JS with no native compile
  step.
- The `ring:smoke` script (live-server mode) keeps its
  previous behaviour: prints `OK server accepted ring
  command` and exits 0 on HTTP 200.

**Non-Goals**

- Replacing `axios` with anything else. The HTTP layer is
  unchanged.
- Changing the signed-payload format
  (`${unixTime}:${ring:<id>}` is correct, the previous
  change fixed it; re-confirmed in two source locations).
- Changing the request body shape, the endpoint, the
  headers, the auth flow, the device ID resolution, or the
  deployment workflow.
- Supporting PKCS#1 PEMs (`-----BEGIN RSA PRIVATE KEY-----`)
  on the input. The FMD server's `AccessKeyData` returns
  PKCS#8; we feed PKCS#8 in. If a future FMD server version
  returns PKCS#1, the change is local to `signRequest`.
- Removing `hash-wasm` from `dependencies`. It is used by
  the auth flow for Argon2id; out of scope for this change.
- Switching the adapter to a different crypto library for
  the auth flow. `FmdAuth` is unchanged.
- Implementing a public-key cache or device-public-key
  fetch. The local round-trip self-test generates its own
  throwaway key pair, and the live ring path still signs
  with the FMD user's private key from `authTokens`.

## Decisions

### D1. Use `node-forge` for signing

- **Decision:** `FmdApi.signRequest` uses `node-forge`'s
  `privateKey.sign(messageDigest, pss)` and
  `publicKey.verify(digestBytes, signature, pss)` API
  for both production signing and the self-test. The
  actual PSS profile is constructed with
  `forge.pss.create(md, mgf, saltLength)` (the
  positional form, see D3) and passed as the `scheme`
  argument to `.sign()` / `.verify()`. There is no
  high-level `forge.pki.signature.createSign` /
  `createVerify` API in `node-forge` — the design's
  earlier assumption was wrong; the spike (task 1.2)
  corrected it. Calling `key.sign(md, pss)` and
  `publicKey.verify(digestBytes, sig, pss)` is the
  pattern `node-forge`'s own x509 code uses.
- **Why:** `node-forge` is the only pure-JS RSA library
  that exposes both `sign` and `verify` with the full
  PSS option set, including the MGF1 hash. The
  alternatives (`node-rsa`, hand-rolled OpenSSL) cannot
  verify with explicit parameters, which is exactly what
  the self-test needs.
- **Why not `node-rsa`:** `node-rsa` uses Node's
  built-in `crypto` module under the hood for the actual
  sign/verify. Node's `crypto.sign("RSA-SHA256-PSS",
  ...)` accepts `saltLength` and `hash` but not the MGF1
  hash. Same problem as WebCrypto, different API.
- **Why not `jsrsasign`:** bigger bundle, more API
  surface, JWS/JWT ballast, slower to load. `node-forge`
  is the conventional choice for this in the Node
  ecosystem (used by `passport-saml`, `xml-crypto`,
  `jsonwebtoken`'s alternative `psSupported` branch, and
  others).

### D2. Load the PKCS#8 key via `pki.privateKeyFromAsn1`, not via a synthetic PEM

- **Decision:** Take the base64-encoded PKCS#8 DER
  (the storage format `authTokens.privateKey` already
  uses), decode it to bytes with the existing
  `base64ToBytes` helper, build a forge buffer, parse it
  with `forge.asn1.fromDer(buffer)`, and hand the result
  to `forge.pki.privateKeyFromAsn1(asn1)`.
- **Why:** the previous change's `signRequest` already
  has a `base64ToBytes` helper. We avoid a PEM round-trip
  (synthesizing the `-----BEGIN PRIVATE KEY-----` /
  `-----END PRIVATE KEY-----` envelope, then asking
  forge to parse it back to ASN.1) when we can go
  directly from bytes → ASN.1 → key. One less
  string-manipulation step that could break with
  non-canonical base64 (line breaks, missing padding).
- **Why not `pki.privateKeyFromPem`:** would require
  building a synthetic PEM envelope, which is more code
  and one more place a future refactor could break.
  Direct ASN.1 path is shorter and the spike
  (task 1.x) confirms it works for the FMD server's
  PKCS#8 output.
- **Edge case:** if a future FMD server version returns
  PKCS#1 (`RSAPrivateKey` ASN.1, not `PrivateKeyInfo`),
  `pki.privateKeyFromAsn1` will fall through to the
  PKCS#1 validator (per node-forge source). The change
  is local — no spec or API change needed.

### D3. PSS profile: `forge.pss.create(md, mgf, saltLength)` (positional)

- **Decision:** Construct the PSS profile once, at the
  top of `signRequest`, as a constant. Reuse the same
  constant in the self-test's `verify` call so the
  parameters cannot drift. The constructor signature is
  **positional**, not an options object:
  ```ts
  const pss = forge.pss.create(
      forge.md.sha256.create(),
      forge.mgf.mgf1.create(forge.md.sha256.create()),
      32
  );
  ```
  Then sign with:
  ```ts
  const md = forge.md.sha256.create();
  md.update(payload, "utf8");
  const sig = privateKey.sign(md, pss);
  return forge.util.encode64(sig);
  ```
  And verify with:
  ```ts
  const vmd = forge.md.sha256.create();
  vmd.update(payload, "utf8");
  const ok = publicKey.verify(vmd.digest().getBytes(), sig, pss);
  ```
  Note: `forge.pss.create`'s second positional argument
  is the MGF1 object returned by
  `forge.mgf.mgf1.create(md)` — a forge mgf instance
  with a `generate(seed, maskLen)` method, **not** a
  MessageDigest. Passing a SHA-256 digest instance by
  mistake is the source of a class of "the signature
  verifies locally but does not match the device
  verifier" bugs that we explicitly want to avoid. The
  spec delta and this design both call it out. The
  design's earlier assumption that `pss.create` took an
  options object with `md` / `mgf1` / `saltLength` keys
  was wrong — the spike (task 1.2) confirmed only the
  positional form is supported in `node-forge@1.4.0`.
- **Why pass the PSS profile as a positional argument
  to `.sign()` / `.verify()` rather than a higher-level
  options object:** `node-forge` does not have a
  high-level signature API. The low-level `key.sign(md,
  pss)` and `publicKey.verify(digestBytes, sig, pss)`
  accept the PSS profile as the second / third
  positional argument, and the constructor
  `forge.pss.create(md, mgf, saltLength)` returns a
  scheme object. This is the pattern `node-forge`'s own
  x509 code (`lib/x509.js`) uses.
- **Why `forge.util.encode64(sig)` for the
  base64-of-signature step:** `key.sign(...)` returns a
  binary string (forge convention). The previous
  change's `bytesToBase64` helper also returns a
  base64-encoded string; the output bytes are
  byte-identical (RFC 4648 base64, no URL-safe
  alphabet, no `=`-stripping). We can keep the
  existing helper for the FMD API's other call sites
  and add a tiny `forge.util.encode64` call here.

### D4. Self-test path: `--verify` mode in `scripts/ring-smoke.mjs`

- **Decision:** Extend the existing smoke script with
  a `--verify` flag. When set, the script:
  1. Generates a 2048-bit RSA key pair via
     `forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })`
     (no network, no env).
  2. Builds the same `pss` constant `signRequest` would.
  3. Signs a fixed payload
     (`1700000000000:ring:test-device`) with the same
     `signRequest` code path the adapter uses (we
     export `signRequest` for testing, or — preferred —
     we factor the signing into a small named export
     `signRingPayload(privateKey, payload)` that
     `sendRingCommand` calls internally and that the
     smoke script imports directly).
  4. Verifies the result with
     `publicKey.verify(digestBytes, signature, pss)`.
  5. Exits 0 on success, 1 on failed verify, 2 on
     missing `--verify` argument shape (defensive).
  The mode does not require `FMD_SERVER_URL`,
  `FMD_USERNAME`, `FMD_PASSWORD`, or `FMD_DEVICE_ID`.
  When the user runs `node scripts/ring-smoke.mjs`
  without `--verify`, the behaviour matches the
  previous change's smoke script exactly.
- **Why export `signRingPayload` from `fmd-api.ts`:**
  the smoke script needs to invoke the same code path
  the adapter uses. Importing the private method
  directly is not possible; making it a module-scope
  function (still under the `FmdApi` namespace
  conceptually, but exported) keeps the test honest.
  The alternative — copying the signing body into the
  smoke script — is the "two implementations drift"
  pattern we explicitly want to avoid.
- **Why a fixed test payload, not a random one:** a
  fixed payload means a future change to the
  concatentation (regression of the previous change's
  fix) shows up immediately as a different signature
  length or shape. A random payload would mask that.
- **Why a fixed `test-device` ID:** same reason. The
  signature length is the canary.

### D5. Keep `crypto.subtle` for everything except ring signing

- **Decision:** `FmdApi.signRequest` is the only
  function that moves to `node-forge`. The rest of
  the adapter (HTTP, JSON, log) keeps using
  `crypto.subtle` indirectly via `axios` /
  `hash-wasm` / `@iobroker/adapter-core` — we do not
  touch those code paths.
- **Why:** the bundle cost of `node-forge` is ~600 kB
  minified. Pulling it in just for ring signing is
  already a 600 kB penalty; pulling it in for
  everything would be more invasive without a
  proportional benefit. `crypto.subtle` is fine for
  AES, HMAC, SHA, etc.
- **Why not remove `crypto.subtle` entirely:** some
  transitive deps (`@iobroker/adapter-core`,
  `hash-wasm`) still use it. We do not control that
  surface. The relevant "no `crypto.subtle` in
  `signRequest`" rule is local to the signing code.

### D6. Dependency placement: `dependencies`, not `devDependencies`

- **Decision:** `node-forge` is listed under
  `dependencies` in `package.json`, pinned to
  `^1.3.1` (or the current 1.x at the time of
  implementation).
- **Why:** the compiled `build/main.js` (which the
  Docker container runs) requires `node-forge` at
  runtime. `devDependencies` are pruned on
  `npm install --production`, which the ioBroker
  adapter installer uses. Putting it in
  `devDependencies` would 4xx every ring command at
  runtime.
- **Why not `optionalDependencies`:** optional
  dependencies are not installed on platforms that
  do not support them, and the option flag is the
  wrong tool for a hard requirement. There is no
  fallback path; the adapter cannot sign without
  the library.
- **Why `^1.3.1`:** the 1.x line is the current
  major. `^` allows minor and patch updates. A
  future 2.x would be a deliberate migration; we
  pin at the major.

### D7. Local `declare module 'node-forge'` shim for TypeScript types

- **Decision:** `node-forge@1.4.0` ships **no** bundled
  `.d.ts` files (the spike, task 1.4, confirmed: `ls
  node_modules/node-forge/*.d.ts` returns nothing, and
  the package.json's `types` field is absent). The
  DefinitelyTyped package `@types/node-forge@1.3.14`
  is a legacy shim whose shape was written for
  `node-forge@0.x` and does not match the current 1.x
  API (e.g. the PSS / mgf1 surface). The cleanest
  fix is a local ambient module declaration at
  `src/types/node-forge.d.ts` that exposes the
  small subset of the API we use:
  `pki.rsa.generateKeyPair`, `pki.privateKeyFromAsn1`,
  `pki.privateKeyToAsn1`, `pki.wrapRsaPrivateKey`,
  `pki.setRsaPublicKey`, `pki.publicKeyFromAsn1`,
  `asn1.fromDer`, `asn1.toDer`, `pss.create`,
  `mgf.mgf1.create`, `md.sha256.create`,
  `util.encode64`, `util.decode64`, `util.createBuffer`.
  The shim is picked up automatically by
  `tsconfig.json`'s `"include": ["src/**/*.ts"]`
  glob. No `package.json` change, no new dependency.
- **Why not `@types/node-forge`:** the
  DefinitelyTyped shim is for `node-forge@0.10.x` and
  declares `asn1` / `pss` shapes that the current 1.x
  package does not export (e.g. `asn1.create` exists
  but `pss.create`'s signature differs from what the
  shim assumes). Adding it and then suppressing
  every shape drift with `// @ts-expect-error` is
  strictly worse than a 30-line local shim.
- **Why not `// @ts-expect-error` on the import:**
  suppresses any future type drift, including real
  breakage in `node-forge@2.x`. The local shim is
  explicit about what shape we depend on.
- **Why no Vite / esbuild externals config:** the
  build pipeline already handles `dependencies`
  correctly (bundles them into `build/main.js`). No
  configuration change needed.

## Risks / Trade-offs

- **[Bundle size: +600 kB minified]** The biggest cost
  of this change. `node-forge` is a multi-purpose
  crypto library; we use ~5% of it. → **Mitigation:**
  the adapter is delivered as a tarball via
  `iobroker url`, not as a hot-loaded JS module, so
  the install-time cost is the only cost. Document
  the bundle delta in the README's "What ships"
  section. Out of scope to switch to a smaller
  PSS-only library (none exists in pure-JS).
- **[node-forge 2.x drift]** A future 2.x release of
  `node-forge` could change the `pss` option shape
  or the `createSign` API. → **Mitigation:** the
  version is pinned to `^1.3.1`; a 2.x migration
  would be a deliberate PR. The self-test catches
  any drift in the local round-trip.
- **[PSS option key naming]** `forge.pss.create`'s
  option is named `md`, not `hash`. Easy to get
  wrong when copy-pasting from snippets. →
  **Mitigation:** the spec delta calls this out
  explicitly; the source comment names both
  `forge.pss.create({md, mgf1, saltLength})` and the
  Android verifier's `PSSParameterSpec` side by
  side; the self-test catches a misnamed key
  immediately (verify returns false).
- **[Self-test doesn't prove the device app will
  verify]** node-forge's PSS verify is not the
  Android Java verifier. They implement the same
  spec (RFC 3447 § 8.1), but a future Android-side
  change to a non-RFC parameter would not be
  caught. → **Mitigation:** the previous change's
  live-server smoke (`ring:smoke` without
  `--verify`) confirms "the FMD server accepted the
  request", and the phone is the only ground truth
  for the device-side verify. The new self-test
  is a third layer (catches PSS-shape drift at
  build time); the live smoke is the second
  (catches auth/transport drift at dev time); the
  phone is the final check. Documented as such
  in `scripts/ring-smoke.mjs`'s header.
- **[First-ever sign-then-verify test]** We are
  adding the first programmatic check of the
  adapter's cryptographic output. The test could
  pass while the device still does not ring (e.g.
  the FMD server delivers a different `Data`
  field than the adapter signed). → **Mitigation:**
  this is the same risk the previous change's
  smoke script had; the test does not claim to
  be a full proof. The test's job is "PSS
  parameters match between sign and verify", not
  "the phone will ring".
- **[Synthetic ASN.1 input]** The FMD server returns
  PKCS#8 PrivateKeyInfo; we feed it through
  `pki.privateKeyFromAsn1` directly. If the FMD
  server at some point returns a non-PKCS#8 / non-
  PKCS#1 format (e.g. a `RSAPublicKey` by mistake,
  or an encrypted PKCS#8), the ASN.1 parse throws.
  → **Mitigation:** `signRequest` already wraps the
  signing in a try/catch and surfaces the throw
  via `info.lastError`; the previous change's
  requirement "signing failures surface to the
  user" carries over. The new requirement delta
  is "all four PSS parameters are set", not
  "all key formats are supported", so this is
  scope-bound.
- **[Self-test slow on first run]** Generating a
  2048-bit RSA pair takes ~500 ms–2 s on a typical
  dev host. The previous change's smoke was
  dominated by the network round-trip; the new
  `--verify` mode is dominated by the key
  generation. → **Mitigation:** the self-test
  runs only on explicit `--verify` invocations;
  the default `ring:smoke` flow does not generate
  a key. Acceptable cost for an offline,
  credential-free, no-server check.

## Migration Plan

1. Land the change behind the existing OpenSpec
   workflow (`/opsx:apply` → tasks done → `/opsx:archive`).
2. Run the spike (task 1.1–1.3 in tasks.md) to confirm
   the `node-forge` API surface matches the design
   decisions D1, D2, D3. If the spike finds a
   mismatch, update the design before code lands.
3. `npm install` locally to confirm
   `node-forge@1.3.x` resolves and installs without
   a `node-gyp` step.
4. `npm run build:tsc` to compile the changed
   `fmd-api.ts` and the extended smoke script. No
   `npm run build:admin` (no Admin-UI changes).
5. `npm run ring:smoke:verify` (or
   `node scripts/ring-smoke.mjs --verify`) on the
   dev host. Expect `OK sign-then-verify round-trip`
   and exit 0.
6. `git push` and follow the deployment workflow in
   `CLAUDE.md` (steps 1, 3–6). The build
   artefacts (`build/main.js` with `node-forge`
   bundled in) are committed alongside the source
   change.
7. Live-server smoke: `npm run ring:smoke` with
   real credentials. Expect `OK server accepted
   ring command` and exit 0 (the server-side
   acceptance test from the previous change still
   holds — the FMD server's `postCommand` does not
   verify the signature, so the only change
   observable to the server is the cost of
   computing a PSS signature with `node-forge`
   instead of `crypto.subtle`).
8. Manual device check: press the Shelly button
   or `setState 0_userdata.0.FindMyDevice.ring.<id>
   true`. The phone rings within ~5 s.

**Rollback:** revert the commit. The previous
implementation (`crypto.subtle`-based signing) is
self-contained in `FmdApi.signRequest` and
reverting the file plus removing `node-forge` from
`package.json` restores the prior state. The
`--verify` mode in the smoke script is additive;
rolling it back is optional.

## Open Questions

- **Is there a PSS-only JS library we missed?**
  Searched the usual suspects (`node-rsa`,
  `jsrsasign`, `node-webcrypto-ossl`,
  `crypto-browserify` PSS branches). None expose
  the MGF1-hash knob in pure JS. `node-forge` is
  the conventional answer. If a future maintainer
  finds a smaller alternative, the change is
  local to D1.
- **Should the live-server smoke script also
  `--verify` after the live call?** That is, sign
  with the user's real private key, then verify
  locally. Requires the public key (returned by
  `GET /pubKey`, which needs auth), and is a
  stronger end-to-end check. Out of scope for this
  change. The local round-trip on a throwaway
  key catches PSS-shape drift; the phone catches
  end-to-end drift.
- **What happens if the FMD server returns a key
  that is not PKCS#8?** `pki.privateKeyFromAsn1`
  throws. The throw is caught by `signRequest`'s
  existing try/catch and surfaces via
  `info.lastError` (preserved from the previous
  change's spec). The user sees a clear error
  message; the alternative is silent (we sign
  garbage, the device drops the command, the user
  sees "ring command sent, phone does not ring").
  The new code is strictly better.
- **Should we also assert the encoded PEM format
  in a unit test?** The smoke script's
  `--verify` mode implicitly covers this (if the
  key is parsed wrong, signing throws and the
  script exits 3). A separate `mocha` unit test
  is not necessary; the round-trip covers the
  load path.
