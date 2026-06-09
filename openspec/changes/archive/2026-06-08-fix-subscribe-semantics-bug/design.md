# Design: Fix Subscribe-Semantics Bug (Bug I)

## Context

The ring-trigger path in `src/main.ts` is non-functional. The
adapter calls `subscribeStates("0_userdata.0.FindMyDevice.ring.*")`
in `onReady`, the call succeeds (no error), but the
`onStateChange` callback does not fire when the user sets a
matching state to `true`. This was discovered while testing the
`add-admin-ui-index-html` change end-to-end; debug instrumentation
(commit `3e2e3f7`) and a `**` wildcard experiment (commit
`b607b37`) were tried, neither revealed the cause, and both were
reverted in `4ecac26`.

The cause is unknown. The proposal lists four plausible
hypotheses; this change runs a focused spike to identify which
one is the actual cause, then writes the fix.

## Goals / Non-Goals

**Goals**

- Identify the true cause of the missing `onStateChange` callback
  for `0_userdata.0.FindMyDevice.ring.*` states.
- Fix the bug, so that ring state changes actually dispatch
  ring commands to the FMD server.
- Add a startup self-check that detects the bug class
  automatically, so future regressions are caught at boot.
- Add debug logging gated by a config flag, so the same
  investigation does not need to be re-run from scratch the
  next time.
- Ship a standalone smoke script for the ring path, mirroring
  the `auth-smoke.mjs` convention.

**Non-Goals**

- Re-touching the auth flow (already fixed in `fix-auth-bug`).
- Re-touching the admin-UI render path (already fixed in
  `add-admin-ui-index-html`).
- Refactoring `main.ts` beyond what is needed for the fix.
- Adding new device-management features (Bug F: `listDevices`
  returning empty, etc.). That is a separate change.

## Decisions

### D1. Investigation spike runs BEFORE the fix

- **Decision:** Phase 1 of this change is a **spike**, not a fix.
  The spike instruments `onStateChange` with `info`-level logging
  (gated by a new `debugRingTrigger` config flag, default `false`),
  deploys to the live container, and runs a controlled experiment:
  1. With `debugRingTrigger=false`, set a manually-created
     `0_userdata.0.FindMyDevice.ring.test` state to `true`.
     Observe whether `onStateChange` fires.
  2. With `debugRingTrigger=true` (re-deploy with flag set),
     repeat step 1. Compare. If step 2 fires but step 1 does not,
     the issue is a log-level config problem (unlikely; we
     already saw the path does not fire).
  3. Re-deploy with `debugRingTrigger=true` and add
     `await this.subscribeStatesAsync(ringPattern)` instead of
     the sync version. Repeat step 1.
  4. Re-deploy with an **explicit per-state subscribe**:
     read `0_userdata.0.FindMyDevice.ring.*` states via
     `getStates`, then `subscribeStates` each one explicitly.
     Repeat step 1.

- **Why:** the spike distinguishes between (a) subscribe-pattern
  semantics (only matches at-subscribe-time states), (b) sync vs
  async subscribe behaviour, (c) namespace quirks, (d) something
  else. Each variant of the spike isolates one hypothesis.

- **Outcome:** the spike result determines which D2–D5 below
  applies. The design document is conditional on the spike's
  finding.

### D2. (Likely fix, hypothesis A: namespace quirk)

- **Decision:** if the spike shows that `subscribeStates` with a
  wildcard on `0_userdata.0.*` does not deliver events, the fix
  is to use the ioBroker-namespaced subscribe path. Replace
  the `this.subscribeStates("0_userdata.0.FindMyDevice.ring.*")`
  call with `this.subscribeForeignStates("0_userdata.0.FindMyDevice.ring.*")`,
  which subscribes to states across all adapters (the default
  `subscribeStates` is restricted to states of THIS adapter).

- **Why:** the ioBroker controller treats `0_userdata.0.*` as
  "user data", which is owned by `admin.0` and visible to all
  adapters. The default `subscribeStates` filter may exclude
  user-data states by design. `subscribeForeignStates` is the
  correct API for cross-adapter state subscriptions.

- **Trade-off:** `subscribeForeignStates` is more permissive
  (subscribes to all matching states, including those we do
  not care about). The regex filter in `onStateChange` still
  limits dispatch to `0_userdata.0.FindMyDevice.ring.*`.

### D3. (Likely fix, hypothesis B: per-state subscribe)

- **Decision:** if the spike shows that wildcards do not match
  for states created after the subscribe call, the fix is to
  use a known device-ID list (from the adapter's `native` config)
  and subscribe to each one explicitly. The list is empty by
  default; users populate it by setting a `deviceId` field in
  the Admin-UI's Hardware Button Trigger panel.

- **Why:** the FMD-Doku shows the phone pushes a command to the
  server, and the server dispatches via ntfy. There is no
  authoritative "list of devices" server-side. Knowing the
  device IDs at boot is a reasonable user-driven configuration
  step.

- **Trade-off:** requires the user to set a config field per
  device. Less magical than "auto-detect from
  `0_userdata.0.FindMyDevice.ring.*`", but more robust.

### D4. (Possible fix, hypothesis C: race condition)

- **Decision:** if the spike shows the issue is timing-related,
  the fix is to (a) call `subscribeStates` AFTER the background
  auth flow, not before, and (b) re-issue the subscribe on every
  adapter restart. The current code does subscribe before
  auth, which is "earlier" but not "later than state creation",
  so this is unlikely to be the cause — but if the spike shows
  it is, the fix is small.

### D5. (Fallback) Replace subscribe with polling

- **Decision:** if all of D2–D4 fail, the fallback is to remove
  the subscribe entirely and instead poll every 5 s (matching
  the existing UI polling cadence):
  ```
  for each id of Object.keys(this.devices) {
      const s = await this.getStateAsync(id);
      if (s && s.val === true && !s.ack) {
          await this.triggerRing(...);
      }
  }
  ```

- **Why:** a 5-second poll is ugly but guaranteed to work
  regardless of subscribe semantics. It also matches the Admin-UI
  Status panel's existing 5 s polling cadence, so the UX is
  consistent.

- **Trade-off:** a ring trigger now has up to 5 s latency. For
  a "find my phone" use case, 5 s is acceptable. For real-time
  alerts, it is not — but that is out of scope.

### D6. Startup self-check (always)

- **Decision:** regardless of which fix is chosen, the startup
  self-check from `fmd-ring-trigger-diagnostics` runs (when
  `debugRingTrigger === true`) and verifies the ring path
  works end-to-end at boot. This catches future regressions of
  the same class.

- **Why:** the bug was invisible for many months because there
  was no test that would have caught it. A self-check at boot
  is the cheapest possible insurance.

### D7. Debug logging gated by config flag

- **Decision:** the `info`-level log in `onStateChange` is
  permanent but gated by the `debugRingTrigger` config flag.
  When the flag is off, only `debug`-level logs fire (the
  current behaviour). When the flag is on, every invocation
  is logged at `info`.

- **Why:** the dev cycle "toggle the flag, restart, see the
  log" is much faster than "edit `main.ts`, commit, push,
  redeploy, observe" — which is what we had to do in the
  prior investigation.

### D8. ring-smoke.mjs

- **Decision:** ship a standalone smoke script for the ring
  path, mirroring `auth-smoke.mjs`. Reads four env vars,
  runs auth, calls `triggerRing`, prints result.

- **Why:** the auth-smoke script is the fastest way to verify
  the auth path is healthy. The same shape for the ring path
  means future debug can isolate "is the auth broken?" from
  "is the ring dispatch broken?" in seconds, not minutes.

## Risks / Trade-offs

- **[Spike inconclusive]** If the spike does not produce a
  clear root cause, D5 (polling) is the safe fallback. The
  ring trigger becomes 5 s-latent, but the user-facing
  functionality is restored. → **Mitigation:** the self-check
  in D6 is run after every fix attempt, so the polling
  fallback is gated by a real test.

- **[New config field `debugRingTrigger`]** Adds a new field
  to the native schema. The field has a default (`false`), so
  existing users are not affected. → **Mitigation:** none
  needed; the field is additive.

- **[Self-check creates a synthetic state]** Even when
  `debugRingTrigger === true`, the self-check creates a
  `__selftest__` state. If the user happens to have a real
  state with that ID, the self-check would conflict. →
  **Mitigation:** the self-check uses a hardcoded
  `__selftest__` suffix; collisions are extremely unlikely.
  The cleanup step removes the state.

- **[UI warning persists after a fix]** If the self-check
  fails once and then succeeds after a code change, the
  yellow warning in the UI should clear on the next
  successful check. → **Mitigation:** the Admin-UI polls
  every 5 s, so the warning auto-clears within one cycle.

## Migration Plan

1. Land the change on `main` behind the normal `git push` +
   Docker deploy + `iobroker url` + workaround + upload +
   restart flow documented in `CLAUDE.md`. The change is in
   `src/main.ts`, `io-package.json` (one new field), and a
   new `scripts/ring-smoke.mjs`. No `npm run build:admin`
   needed (no admin-UI changes). The `build/main.js`
   companion commit is required (container reads compiled
   output).
2. Run the spike (Phase 1, Tasks 1.1–1.3 in `tasks.md`).
   Identify the root cause.
3. Apply the fix corresponding to the spike's finding
   (D2/D3/D4/D5).
4. Run the startup self-check in the live container
   (Task 4.x). Confirm it passes.
5. Manually set a ring state in the container. Confirm the
   ring command is dispatched (log line `Ring state triggered
   for device: <id>`).

**Rollback:** revert the commit. The pre-change state is
known (subscribes do not fire); reverting returns the
adapter to that state. The new `debugRingTrigger` config
field is purely additive and does not affect existing users.

## Open Questions

- **Will the spike actually distinguish the four
  hypotheses?** Each spike variant exercises a different
  code path; if the issue is "something else entirely"
  (e.g. the controller version has a known bug), the spike
  may show "none of the above work" and the polling
  fallback (D5) becomes the path. The self-check (D6)
  is the safety net.

- **Is the `__selftest__` state ID a real concern?** Real
  FMD device IDs are random base32 strings; the chance of
  collision is negligible. But the cleanup step
  (`setObject` to remove) is still required to keep the
  user's namespace clean.
