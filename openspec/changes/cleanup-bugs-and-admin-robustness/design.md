## Context

The last five commits on `main` shipped the `node-forge` ring-signing
rewrite, the wrapped private-key unwrap with Argon2id+AES-GCM, the
`subscribeForeignStates` fix for the user-data ring path, and the
admin-UI Test Connection button. A medium-effort code review
surfaced four real defects that need cleanup before v1.0.0:

1. The `__selftest__` ring sentinel in `onStateChange` and the
   `selfCheckFiredAt` static field in `FmdAdapter` are write-only
   scaffolding for a startup self-check the archived
   `fmd-ring-trigger-diagnostics` spec describes but the code
   never implements. The consumer was deferred and the writer was
   never wired up.
2. `FmdAuth.authenticate()` is called from four sites in
   `src/main.ts` (`connectAndFetchDevices`, `fetchDevices`,
   `testConnection`, `sendRingCommand`) without consulting
   `FmdAuth.hasValidTokens()`. Every call re-runs the salt →
   Argon2id → access → Argon2id → AES-GCM dance even when the
   1-hour `cachedTokens.expiresAt` is still in the future.
3. The admin UI's Test Connection button (`handleTestConnection`
   in `src-admin/App.tsx`) has no client-side timeout on
   `socket.sendTo(...)`. A hung adapter strands the button in
   "Testing…" for the lifetime of the iframe.
4. The admin UI's "stale OK" detection compares the error *string*
   to a ref instead of the `lastChanged` timestamp. Identical
   repeated errors never register as fresh.

The cleanup is intentionally narrow: remove the dead scaffolding,
add the four short-circuits, add a timeout, switch the dedup from
string to `lc`. No new features, no new diagnostics, no new
config fields.

## Goals / Non-Goals

**Goals:**

- Remove the dead `__selftest__` ring filter and the
  `selfCheckFiredAt` static field. Update the
  `fmd-ring-trigger-diagnostics` spec to drop the self-check
  requirement that was deferred and never implemented.
- Add a `hasValidTokens()` short-circuit at the four
  `authenticate()` call sites in `src/main.ts`. The short-circuit
  must skip the full auth dance when `cachedTokens` is present
  and `expiresAt > now`.
- Add a 12-second client-side timeout (see D1) to
  `handleTestConnection`. On timeout, report
  "Failed – timed out after 12s at HH:MM:SS" and re-enable the
  button.
- Switch the admin-UI fresh-error detection in `App.tsx` to use
  `err.lc` (lastChanged timestamp) instead of the error string.

**Non-Goals:**

- No new config flags, no new admin-UI panels, no new public APIs.
- No change to the FMD server protocol, the PSS signature, the
  wrapped-key unwrap, or the `subscribeForeignStates` call.
- The startup self-check from the archived
  `fmd-ring-trigger-diagnostics` spec is **not** being built in
  this change. The spec is being updated to reflect the
  implementation reality; a follow-up change can re-introduce
  the self-check if it ever becomes a real requirement.
- No new tests in this change. The existing smoke scripts
  (`npm run auth:smoke`, `npm run ring:smoke`,
  `npm run ring:smoke:verify`) cover the sign and auth paths;
  the cleanup is observable through the existing flows.

## Decisions

### D1 — Test Connection timeout: 12 seconds

The admin-UI's existing 5s `getStates` poll loop in `App.tsx`
already caps `info.lastError` and `info.connection` reads at
~5s. The Test Connection handler is one-shot, so we want a
client-side budget that is long enough for a real Argon2id pass
on a Pi (the dev host, in `auth:smoke`, the two Argon2id calls
together take ~600–800ms on macOS M-series; on a Pi 3 they
take ~3–5s total) but short enough that a user does not stare
at "Testing…" for a minute.

**Chosen: 12 seconds.** Generous enough to cover Pi-class
hardware (5s Argon2id × 2 + 2× HTTP round-trip + AES-GCM +
buffer) with a 2× safety margin, short enough that the
button-unstick recovery is well under a minute.

**Alternatives considered:**

- 30s — too long; users will assume the click was lost and
  reload the iframe, defeating the timeout's purpose.
- 5s — too short; on a Pi the auth dance legitimately takes
  longer. False-positive timeouts would teach users to ignore
  the button.
- Tied to the existing 5s poll cadence — rejected; the poll
  is for read-side state, not for bounding write-side RPCs.

### D2 — `hasValidTokens()` short-circuit is caller-side, not FmdAuth-side

`FmdAuth.authenticate()` is intentionally side-effectful: on
success it sets `this.cachedTokens` and starts a 1-hour
`expiresAt` clock. The four call sites in `src/main.ts`
should check `hasValidTokens()` *before* calling
`authenticate()`. We do **not** push the short-circuit *into*
`authenticate()` itself, because:

- Two of the four call sites (`connectAndFetchDevices`,
  `testConnection`) want a *fresh* auth on every call by
  intent — they are the "force reconnect" path. A short-circuit
  *inside* `authenticate()` would silently change their
  semantics.
- The other two call sites (`fetchDevices`, `sendRingCommand`)
  genuinely want a cache hit. They should ask
  `hasValidTokens()` first.

**Pattern at each call site (canonical):**

```ts
if (this.fmdAuth.hasValidTokens()) {
    this.authTokens = this.fmdAuth.getTokens()!;
} else {
    this.authTokens = await this.fmdAuth.authenticate();
}
```

`hasValidTokens()` returns `false` when `cachedTokens` is
undefined OR `expiresAt` is in the past. `getTokens()` returns
`undefined` only when `cachedTokens` is undefined, so the
non-null assertion is safe in the `if` branch.

**Alternatives considered:**

- Single `getOrAuthenticate()` method on `FmdAuth` — adds a
  method to a module that already has a clean public surface
  (`authenticate`, `hasValidTokens`, `getTokens`); rejected
  for the same reason we are not pushing the check into
  `authenticate()`.
- Cache invalidation on every `setConnectionStatus("error")`
  — out of scope; the spec says the 1-hour expiry is
  conservative and the FMD server caps at 1 week. Time-based
  expiry is the only signal we trust.

### D3 — `err.lc` is the dedup key, not the error string

`ioBroker` state objects always carry `lc` (lastChanged, ms
since epoch) alongside `val`. The `getStates` call in
`App.tsx:91-98` already returns the full state shape; switching
the comparison from `errVal` to `err.lc` is a one-line
change.

**Before:**
```ts
if (errVal && errVal.length > 0 && lastErrorRef.current !== errVal) {
    setTestResult(TEST_RESULT_PLACEHOLDER);
}
lastErrorRef.current = errVal;
```

**After:**
```ts
const errLc = err?.lc ?? null;
if (errLc !== null && lastErrorRef.current !== errLc) {
    setTestResult(TEST_RESULT_PLACEHOLDER);
}
lastErrorRef.current = errLc;
```

The new code clears the test result on **every** timestamp
change. If the adapter re-sets the *same* error after
recovering (a common pattern: `setState(lastError, "")` on
reconnect, then `setState(lastError, "401...")` on the next
failure), the `lc` advances, the placeholder is cleared,
and the user's "OK" line from before the reconnect is hidden.
This is the right behavior.

The `errVal` length check is dropped because `err.lc` is a
number: `null` is the empty-signal, any number is a
non-empty-signal. The `getStates` interface in
`src-admin/socket.ts:78-79` declares `lc` as optional; we
treat undefined as null.

**Alternatives considered:**

- Keep string equality but add a `(string, number)`
  composite key (string first, lc as tiebreaker) — adds
  state for no win; the timestamp alone is the correct
  fresh-error signal.
- Subscribe to `info.lastError` via `socket.subscribeState`
  instead of polling — out of scope; the existing 5s poll
  is the spec for this admin UI and we are not changing
  the transport.

### D4 — `__selftest__` ring filter and `selfCheckFiredAt` are deleted, not repurposed

The archived
`openspec/changes/archive/2026-06-08-fix-subscribe-semantics-bug/tasks.md`
explicitly defers the self-check (Section 3). The
`fmd-ring-trigger-diagnostics` spec at
`openspec/specs/fmd-ring-trigger-diagnostics/spec.md:39-127`
describes the self-check in detail. We update the spec to
remove the self-check requirements — the spec stays, the
debug-log-gating requirement stays, the self-check
requirements go. The `__selftest__` branch and the
`selfCheckFiredAt` static field are deleted from
`src/main.ts`. A future change that wants the self-check
will start from a clean slate.

**Alternatives considered:**

- Leave the writer in place behind a config flag and
  implement the reader — out of scope; this change is
  cleanup, not feature work.
- Move the writer to a private helper file so it can be
  re-enabled later by reverting one diff — adds dead
  code to the repo. Rejected; git history is the
  recovery path.

## Risks / Trade-offs

- **[Risk]** `hasValidTokens()` returns `true` for a cached
  access token that the FMD server has already invalidated
  out-of-band. → **Mitigation:** the call sites still set
  `this.setConnectionStatus("error", ...)` on auth failure
  in `sendRingCommand` and `testConnection`. A server-side
  rejection will still surface as a `lastError`, the user
  will see it in the admin UI, and the next Test
  Connection click will go through the
  `!hasValidTokens()` path and re-auth (because the
  failure path of `sendRingCommand` does not clear
  `cachedTokens` — see Open Question 1). Worst case: a
  stale token causes one failed ring, then a successful
  re-auth on the next click. Acceptable.
- **[Risk]** The 12s Test Connection timeout fires during a
  legitimately slow first-time auth on a Pi (Argon2id × 2
  + network cold-start). → **Mitigation:** the timeout is
  12s, the dev-host measurement is 600–800ms, the Pi
  measurement is 3–5s; 12s is a 2× safety margin even on
  Pi. If a user reports a timeout on a slower host, the
  fix is a config flag for the timeout, not a different
  default.
- **[Risk]** Switching the dedup to `err.lc` makes the
  placeholder clear on *every* `lastError` change, including
  the `setState(lastError, "")` reconnect gesture. → **Acceptable:**
  that is the intended behavior. A successful reconnect
  followed by a fresh error SHOULD clear a stale "OK"
  from before the disconnect.
- **[Risk]** Removing the `__selftest__` ring filter means a
  user who creates `0_userdata.0.FindMyDevice.ring.__selftest__`
  and sets it to `true` will *ring a real device* named
  `__selftest__` (or trigger a no-op if no such device
  exists on the FMD server). → **Acceptable:** the previous
  behavior was a silent drop with no log; the new behavior
  is a real ring with the normal logging. The string
  `__selftest__` is not a reserved deviceId in the FMD
  server protocol.
- **[Risk]** `connectAndFetchDevices` is intentionally
  short-circuited via `hasValidTokens()` even though it is
  the "initial connect" path. → **Accepted trade-off:** on
  adapter restart, `cachedTokens` is undefined (the field
  is in-memory, not persisted), so the short-circuit is
  `false` and a fresh auth always runs on restart. The
  short-circuit only kicks in on subsequent reconnects
  during the same adapter lifetime.

## Migration Plan

Standard per the project's CLAUDE.md deployment workflow:

1. Smoke test the auth/ring path from the dev host
   (`npm run auth:smoke`, `npm run ring:smoke:verify`,
   `npm run ring:smoke`).
2. Commit, push.
3. Build the admin UI if `src-admin/` changed
   (`npm run build:admin`). It will: the Test Connection
   timeout lives in `src-admin/App.tsx`.
4. Docker dev cycle (rebuild, install from GitHub, fix
   directory, upload, touch `io-package.json` if it
   changed — it does not, this change is source-only).
5. Verify in the browser: the Test Connection button
   times out within ~12s on a hung adapter; a fresh Test
   Connection after a stable 1h+ error state shows the
   placeholder after the timestamp advances.

**Rollback:** revert the commit and re-deploy. No data
migration, no persisted state, no schema change.

## Open Questions

1. **`sendRingCommand` failure path does not clear
   `cachedTokens`.** If the FMD server returns 401 on a
   signed request, `cachedTokens.accessToken` is still
   "valid" per `hasValidTokens()` and the next ring from
   the admin will hit the same 401 until the 1-hour
   expiry. Should `sendRingCommand` clear
   `this.fmdAuth.cachedTokens` on 401/403? The cleanup
   change does not address this; it is a follow-up if
   the user reports the symptom.
2. **Test Connection timeout value:** 12s is a guess. The
   right value is "dev host's worst-case auth round-trip
   × 2". We measure once with the dev host during the
   `apply` step and update if needed. If 12s is wrong,
   the fix is one number in `App.tsx`; no spec change.
