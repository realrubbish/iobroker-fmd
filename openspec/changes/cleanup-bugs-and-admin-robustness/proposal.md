## Why

A medium-effort code review of the last five commits on `main` (which
shipped the `node-forge` ring-signing rewrite, the private-key
unwrapping, the `subscribeForeignStates` fix, and the Test Connection
button) surfaced four real defects and a half-finished feature. Each
is small in isolation, but together they leave the adapter looking
shipped while behaving inconsistently with what the docs and the
archived change tasks promise:

- A `__selftest__` ring sentinel is hard-coded into `onStateChange`,
  and the `selfCheckFiredAt` static field it is supposed to feed has
  zero readers. The archived `fmd-ring-trigger-diagnostics` spec
  describes a startup self-check that the running code does not
  implement. A user who happens to create a ring state with that
  deviceId will have the ring silently swallowed.
- `FmdAuth.authenticate()` runs the full salt → Argon2id → access →
  Argon2id → AES-GCM dance on every Test Connection click, every
  ring from the admin UI, and every `fetchDevices` call, even when
  the cached access token (with its `expiresAt` timestamp) is still
  valid. `hasValidTokens()` exists in `FmdAuth` but is never called
  from `src/`. The 1-hour expiry is set but never checked.
- The Test Connection button on the admin UI can strand itself in
  "Testing…" forever: `await socket.sendTo(...)` has no client-side
  timeout, no `AbortController`, and `testRunning` is only reset in
  the same callback's `finally`. A hung adapter or socket blip pins
  the button disabled until the iframe is reloaded.
- The admin UI's "stale OK" detection compares the error *string*
  between polls, not the `lastChanged` timestamp. An identical
  error message that persists for hours prevents the placeholder
  from clearing after a subsequent successful test, leaving the
  user looking at "OK – connected at HH:MM:SS" while the adapter is
  in a long-running error state with the same string.

This change is the cleanup pass. It is intentionally scoped to the
code-review findings only; no new features, no new diagnostics, no
spec drift beyond what the cleanup forces.

## What Changes

- **Remove the dead `selfCheckFiredAt` writer and the `__selftest__`
  ring filter in `onStateChange`.** The archived
  `fmd-ring-trigger-diagnostics` spec is updated to drop the
  self-check requirement (it never landed and the write-side
  scaffolding is the only thing that did). The ring-state
  dispatch continues to work for any other deviceId.
- **Add a `hasValidTokens()` short-circuit to the four
  `authenticate()` call sites** (`connectAndFetchDevices`,
  `fetchDevices`, `testConnection` message handler, `ring` message
  handler in `src/main.ts`). When the adapter has tokens whose
  `expiresAt` is still in the future, the call reuses the cached
  `accessToken` + `privateKey` and skips the 2× Argon2id
  + 2× HTTP round-trip + AES-GCM unwrap.
- **Add a client-side timeout to the admin UI's Test Connection
  button** (10–15s, picked in the design step). On timeout the
  button reports "Failed – timed out after Ns at HH:MM:SS" and
  re-enables itself, so a hung adapter no longer strands the UI.
- **Switch the admin UI's "fresh error" detection from string
  equality to `err.lc` (lastChanged timestamp) equality** in
  `App.tsx`. An identical-but-fresh error now correctly clears a
  stale OK result; an OK that is still fresh does not get cleared
  by an old identical error.

No breaking changes for end users. The behavior at the public
boundary (admin UI button, ring dispatch, FMD server API) is
identical when things work; the cleanup only changes the failure
and hot-path behavior.

## Capabilities

### New Capabilities

None. The change tightens existing behavior; it does not introduce
new user-visible capability.

### Modified Capabilities

- `fmd-ring-trigger-diagnostics`: drop the `__selftest__`
  self-check requirement from the spec (the consumer side was
  never built; the writer side is being removed by this change).
  No other requirement in this capability is affected.
- `fmd-auth`: tighten the `expiresAt` semantics — the spec already
  states the cached tokens "expire after 1 hour" but does not
  pin *which* call sites check expiry before re-authenticating.
  This change adds the short-circuit requirement.
- `admin-ui`: add the Test Connection button timeout requirement
  and the `err.lc`-based fresh-error detection requirement.

## Impact

- **`src/main.ts`** — drop `selfCheckFiredAt` declaration, the
  `__selftest__` match arm in `onStateChange`, and the JSDoc that
  references Task 3.1; add `hasValidTokens()` checks at the four
  `authenticate()` call sites.
- **`src/lib/fmd-auth.ts`** — no API changes. The class gains no
  new public methods; the short-circuit is purely a caller-side
  guard.
- **`src-admin/App.tsx`** — `handleTestConnection` gains a
  `Promise.race` against a `setTimeout`; the `lastErrorRef` dedup
  switches from string equality to `err.lc` equality (the polled
  state object already carries `lc`).
- **Specs** — `fmd-ring-trigger-diagnostics/spec.md` loses the
  self-check requirements; `fmd-auth/spec.md` gains a
  "short-circuit" requirement; `admin-ui/spec.md` gains two
  requirements (Test Connection timeout, fresh-error detection by
  timestamp).
- **No dependency changes**, no `io-package.json` changes, no
  admin schema changes, no migration steps.
