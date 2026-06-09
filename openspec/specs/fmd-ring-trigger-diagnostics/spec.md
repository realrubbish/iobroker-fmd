# Capability: fmd-ring-trigger-diagnostics

## Purpose

TBD

## Requirements

### Requirement: Debug logging for the ring path is gated by a config flag
The adapter SHALL expose a boolean config field
`debugRingTrigger` (default `false`). When `true`, every
`onStateChange` invocation SHALL be logged at the `info` level
with the ID, value, and ack flag. When `false`, only the
filtered-out cases (state === null, state.ack === true) are
suppressed; the path-firing cases are still logged at `debug`.

#### Scenario: Flag is off (default)
- **WHEN** `debugRingTrigger === false` (the default)
- **THEN** `onStateChange` does NOT log every invocation at `info`
- **AND** only `debug`-level logs appear for normal state
  changes
- **AND** the ring path's "Ring state triggered for device: ..."
  log line still appears at `info` (so users can see ring events)

#### Scenario: Flag is on
- **WHEN** `debugRingTrigger === true`
- **THEN** `onStateChange` logs every invocation at `info` with
  ID, value, and ack flag
- **AND** the startup self-check (next requirement) runs and logs
  its outcome

#### Scenario: Flag toggling
- **WHEN** the user toggles `debugRingTrigger` from `false` to
  `true` and saves
- **THEN** the new value takes effect on the next adapter
  restart (no hot-reload; the debug instrumentation is read once
  in `onReady`)

### Requirement: Startup self-check verifies the ring subscribe path
The adapter SHALL run a self-check at the end of `onReady` (after
subscribe and after the auth-flow kicks off) that verifies the
ring subscribe path actually delivers events.

The self-check SHALL:
1. Pick a non-existent
   `0_userdata.0.FindMyDevice.ring.__selftest__` state ID.
2. Call `setObjectNotExists` to create the state as a
   `type: "state"` with `common.type: "boolean"`.
3. Wait 100 ms (give the controller time to propagate the
   subscribe match).
4. Call `setState` to set the state to `true` (with
   `ack === false`).
5. Wait 200 ms.
6. Check whether a global "self-check fired" flag was set inside
   `onStateChange`.
7. Clean up: `setObject` with `common: { name: "deleted" }`
   (or a no-op if the controller has no delete API in this
   version).

The self-check SHALL run only when `debugRingTrigger === true` to
avoid surprising the user with synthetic state mutations in
production.

#### Scenario: Self-check passes
- **WHEN** `debugRingTrigger === true` and the subscribe path is
  healthy
- **THEN** the self-check creates the test state, sets it to
  `true`, sees the callback fire, logs
  `Ring subscribe self-check OK`, and cleans up the test state
- **AND** the ring command is NOT sent (the test state ID
  `__selftest__` is filtered out before `triggerRing` is called)

#### Scenario: Self-check fails
- **WHEN** `debugRingTrigger === true` and the subscribe path is
  broken (callback does NOT fire within 200 ms)
- **THEN** the self-check logs an error at the `error` level:
  `Ring subscribe self-check FAILED: callback did not fire
  within 200 ms. Ring state changes will NOT trigger ring
  commands. See docs/admin-ui.md#troubleshooting.`
- **AND** the test state is cleaned up

#### Scenario: Self-check skipped
- **WHEN** `debugRingTrigger === false` (the default)
- **THEN** the self-check is skipped entirely
- **AND** no synthetic state is created at startup

### Requirement: A standalone dry-run script can exercise the ring path
The repository SHALL ship `scripts/ring-smoke.mjs`, a Node ESM
script that:
1. Reads `FMD_SERVER_URL`, `FMD_USERNAME`, `FMD_PASSWORD`,
   `FMD_RING_DEVICE_ID` from environment variables.
2. Runs the full `FmdAuth.authenticate()` flow.
3. Builds an `AdapterSocket`-compatible object and calls
   `triggerRing(<device-id>)`.
4. Prints `OK ring sent to <device-id>` on success, exits 0.
5. On failure prints the error and exits 1.

This is the same shape as `scripts/auth-smoke.mjs` and reuses
the same env-var conventions.

#### Scenario: Ring smoke test against a real FMD server
- **WHEN** the developer runs
  `FMD_SERVER_URL=https://fmd.example.com FMD_USERNAME=alice
  FMD_PASSWORD=secret FMD_RING_DEVICE_ID=<some-id> node
  scripts/ring-smoke.mjs`
- **THEN** the script runs the auth flow
- **AND** calls `FmdApi.sendRingCommand("<some-id>")`
- **AND** prints `OK ring sent to <some-id>` and exits 0

#### Scenario: Missing env
- **WHEN** any required env var is missing
- **THEN** the script prints which variable is missing and exits 2

### Requirement: When the ring path is broken, the Admin-UI shows a warning
The Admin-UI's Connection Status panel SHALL display a yellow
warning text ("Ring trigger path inactive — see logs") when the
startup self-check fails.

#### Scenario: Self-check fails and UI reflects it
- **WHEN** the startup self-check fails
- **THEN** within 5 s (one polling cycle) the Admin-UI's
  Connection Status panel shows the yellow warning text below
  the Last Error field
- **AND** the warning is cleared on the next successful self-check

#### Scenario: Self-check is skipped
- **WHEN** the self-check is skipped (`debugRingTrigger === false`)
- **THEN** no warning is shown in the UI
- **AND** the form behaves as before
