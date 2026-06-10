# Capability: fmd-ring-trigger-diagnostics (delta)

## REMOVED Requirements

### Requirement: Startup self-check verifies the ring subscribe path
**Reason:** The implementation described in this requirement (the
self-check running at the end of `onReady`, writing a synthetic
`0_userdata.0.FindMyDevice.ring.__selftest__` state, and reading
back a "self-check fired" flag) was deferred from the
`fix-subscribe-semantics-bug` change and never landed. The
write-side scaffolding in `onStateChange` (the `__selftest__`
match arm and the `FmdAdapter.selfCheckFiredAt` static field) is
a half-implemented feature that has no consumer. A user who
creates a ring state with that deviceId has the ring silently
swallowed. The cleanup change `cleanup-bugs-and-admin-robustness`
removes the writer and the static field.

The "self-check passes / fails" scenarios that the Admin-UI
warning requirement depends on are also removed (see below).
The `debugRingTrigger` config flag and the debug-logging
requirement that depend on it are unchanged.

**Migration:** none. The self-check was never a user-visible
feature. A future change that wants to add a real subscribe-path
self-check will start from a clean slate, not from this
half-implementation.

### Requirement: When the ring path is broken, the Admin-UI shows a warning
**Reason:** This requirement depends on the removed
"Startup self-check verifies the ring subscribe path"
requirement. With no self-check, the UI has no signal to
display a "Ring trigger path inactive" warning.

**Migration:** none. The Admin-UI does not currently show such
a warning, and the cleanup change does not add one. A future
change that re-implements the self-check can re-introduce
the corresponding UI requirement.

## MODIFIED Requirements

### Requirement: Debug logging for the ring path is gated by a config flag
The adapter SHALL expose a boolean config field
`debugRingTrigger` (default `false`). When `true`, every
`onStateChange` invocation SHALL be logged at the `info` level
with the ID, value, and ack flag. When `false`, only the
filtered-out cases (state === null, state.ack === true) are
suppressed; the path-firing cases are still logged at `debug`.

The adapter SHALL NOT maintain a `__selftest__` ring sentinel
or a `selfCheckFiredAt` static field. There is no startup
self-check in the current implementation.

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

#### Scenario: Flag toggling
- **WHEN** the user toggles `debugRingTrigger` from `false` to
  `true` and saves
- **THEN** the new value takes effect on the next adapter
  restart (no hot-reload; the debug instrumentation is read once
  in `onReady`)
