# Proposal: Fix Subscribe-Semantics Bug (Bug I)

## Why

The `iobroker-fmd` adapter's ring-trigger path is non-functional.
Manually creating a state `0_userdata.0.FindMyDevice.ring.<id>` in
the ioBroker Objects tab and setting it to `true` does NOT cause the
adapter's `onStateChange` to fire, so the ring command is never
dispatched to the FMD server. The auth flow (Bug D, fixed in the
previous change `fix-auth-bug`) works correctly — `info.connection`
is `connected`, the admin-UI's Status panel shows live updates — but
the user-facing ring path is dead.

The bug was discovered while testing the `add-admin-ui-index-html`
change's manual Docker test. Debug instrumentation (info-level log
inside `onStateChange`, plus `**` wildcard experiment) was added in
commits `3e2e3f7` and `b607b37`, then reverted in `4ecac26` after
neither revealed the cause. The cause is one of several plausible
ioBroker subscribe-semantics quirks; we do not know which one without
a focused investigation.

## What Changes

- **Add a one-time investigation spike** to identify the true cause
  of the missing `onStateChange` callback. The spike runs the
  adapter with extra debug logging, then exercises the
  state-subscribe / state-set cycle in a way that distinguishes
  between the candidate root causes (see D1–D4 in `design.md`).
- **Fix the bug** once the spike identifies the root cause. The
  fix is unknown until the spike runs, so the "what changes" list
  is intentionally conditional on the spike's outcome. Plausible
  fixes include: (a) explicitly `setObjectNotExists` + per-state
  `subscribeStates` for known device IDs, (b) use
  `subscribeStatesAsync` with a controller-level "match-on-create"
  hint, (c) replace the wildcard subscribe with an explicit
  `getStates` + `subscribeStates` per state at boot, (d) use
  `onStateChange` re-binding via `setForeignState`-style hooks, or
  (e) something else discovered during the spike.
- **Add debug logging** that is gated behind an adapter-config flag
  (default off), so future debugging of the same path does not
  require re-instrumenting.
- **Add a regression test** in the form of an in-adapter
  self-check that runs at startup: if no
  `0_userdata.0.FindMyDevice.ring.*` state exists, the adapter
  creates one and waits for the user to set it; if the
  self-triggered state change does NOT cause `onStateChange` to
  fire, the adapter logs a loud warning identifying the subscribe
  path as broken.

**No** change to the auth flow (already fixed in
`fix-auth-bug`). **No** change to the admin-UI. **No** change to
`io-package.json` (unless the fix requires a new schema field).

## Capabilities

### New Capabilities

- `fmd-ring-trigger`: How the adapter translates a user-triggered
  `0_userdata.0.FindMyDevice.ring.<id> = true` state change into
  a `FmdApi.sendRingCommand(<id>)` call. Covers the subscribe
  pattern, the state-filter logic, the trigger dispatch, and how
  the ring-state is reset to `false` after a successful send.
- `fmd-ring-trigger-diagnostics`: How the adapter helps the
  developer / power user diagnose the trigger path when it does
  not fire. Covers the debug logging and the startup self-check.

### Modified Capabilities

_None._ This change is self-contained in the ring-trigger code
path. The auth (`fmd-auth`), auth-testing (`fmd-auth-testing`),
and admin-UI capabilities are not affected.

## Impact

- **`src/main.ts`:** add debug logging in `onStateChange` (gated
  by a config flag), add a startup self-check that triggers its
  own state change and verifies the callback fires, replace or
  augment the existing `subscribeStates("0_userdata.0.FindMyDevice.ring.*")`
  with whatever the spike identifies as the correct pattern.
- **`io-package.json`:** potentially one new config field
  (`debugRingTrigger`, boolean, default `false`) to gate the
  verbose logging. If the spike identifies that a different
  mechanism (not a config field) is the right approach, this
  field may not be needed.
- **No** new runtime dependency. `tsc --build` is enough.
- **No** change to `docs/admin-ui.md`, `CLAUDE.md`, or
  `README.md`. The existing UI already supports the trigger
  path; the change is purely server-side in the adapter's
  subscribe / dispatch logic.
