## ADDED Requirements

### Requirement: Ring state changes trigger the FMD ring command
The adapter SHALL dispatch a ring command to the FMD server when a
user sets any state matching
`0_userdata.0.FindMyDevice.ring.<id>` to `true` with `ack === false`,
and SHALL then reset the state to `false` with `ack === true`.

The dispatch path is `onStateChange(id, state)` in `src/main.ts`:
match the ID against the regex `^0_userdata\.0\.FindMyDevice\.ring\.(.+)$`,
check `state.val === true && state.ack === false`, and call
`this.triggerRing(deviceId)`.

#### Scenario: Manually created state, set to true
- **WHEN** the user creates a state
  `0_userdata.0.FindMyDevice.ring.<some-id>` in the ioBroker Objects
  tab (via `setObject` from `0_userdata.0`)
- **AND** sets the state value to `true` (with `ack === false`)
- **THEN** the adapter's `onStateChange` callback is invoked with
  the matching ID
- **AND** the adapter logs `Ring state triggered for device: <some-id>`
- **AND** the adapter calls `FmdApi.sendRingCommand("<some-id>")`
- **AND** the FMD server receives the command and pushes a ring to
  the phone
- **AND** the state is reset to `false` (with `ack === true`)

#### Scenario: State set to false (e.g. by the adapter itself)
- **WHEN** the adapter sets
  `0_userdata.0.FindMyDevice.ring.<id>` to `false` with `ack === true`
- **THEN** the `onStateChange` callback is invoked
- **AND** the callback filters the event out because
  `state.ack === true`
- **AND** no ring command is sent

#### Scenario: State set to true by the adapter (self-ack)
- **WHEN** the adapter (or any other adapter) sets
  `0_userdata.0.FindMyDevice.ring.<id>` to `true` with `ack === true`
- **THEN** the `onStateChange` callback is invoked
- **AND** the callback filters the event out because `state.ack === true`
- **AND** no ring command is sent (avoids ring-on-ring loops)

### Requirement: The ring subscribe path is active at adapter ready
The adapter SHALL call `subscribeStates` (or equivalent) for
`0_userdata.0.FindMyDevice.ring.*` in `onReady`, BEFORE the
background authentication flow starts, so that the ring path is
armed even if authentication takes seconds.

The exact subscribe mechanism (wildcard `*` vs `**` vs explicit
per-state subscribe vs other) is a design decision; what matters
is that by the time the adapter logs `FMD adapter ready. Server:
<url>`, the ring path is armed.

#### Scenario: Subscribe call is present at adapter start
- **WHEN** the adapter starts
- **THEN** the subscribe call appears in `onReady` BEFORE the
  `Starting FMD authentication flow` log line
- **AND** a log line confirms the subscribe happened (e.g.
  `Subscribed to ring pattern: 0_userdata.0.FindMyDevice.ring.*`)

#### Scenario: Subscribe call's exact pattern
- **WHEN** the subscribe mechanism is chosen during implementation
- **THEN** the chosen pattern is documented in
  `src/main.ts` (in a comment above the subscribe call) with a
  short note explaining why this pattern was chosen and what
  alternatives were considered

### Requirement: Bug I is fixed: the subscribe path actually delivers events
This is the bug being fixed. The adapter's `onStateChange` SHALL
be invoked for state changes on `0_userdata.0.FindMyDevice.ring.*`
states, regardless of whether the state existed at the time of
subscribe (e.g. user creates the state AFTER the adapter started).

#### Scenario: State created after adapter start, then set to true
- **WHEN** the adapter is already running
- **AND** the user creates a new state
  `0_userdata.0.FindMyDevice.ring.test`
- **AND** sets the state to `true` (with `ack === false`)
- **THEN** `onStateChange` is invoked
- **AND** the ring command is dispatched (as in the base
  requirement)

#### Scenario: Adapter restart after state exists
- **WHEN** the state `0_userdata.0.FindMyDevice.ring.test` exists
- **AND** the user restarts the adapter (`iobroker restart
  iobroker-fmd.0`)
- **AND** sets the state to `true` again after the restart
- **THEN** `onStateChange` is invoked
- **AND** the ring command is dispatched

### Requirement: Failures in the ring path are visible, not silent
The adapter SHALL log a clear, loud warning at startup if the
ring subscribe path is broken for any reason (controller quirk,
missing dependency, version mismatch). The warning SHALL explain
the consequence ("ring state changes will not trigger ring
commands") and SHALL point the developer at the diagnostics
capability.

#### Scenario: Subscribe returns no error but the path is broken
- **WHEN** the subscribe call completes without error
- **AND** the startup self-check (see `fmd-ring-trigger-diagnostics`
  capability) detects that the callback is not fired
- **THEN** the adapter logs an error at the `error` level with a
  clear message and a pointer to the diagnostics

#### Scenario: Subscribe returns an error
- **WHEN** the subscribe call rejects (e.g. `subscribeStatesAsync`
  with a malformed pattern)
- **THEN** the adapter logs the rejection at the `error` level
- **AND** the adapter does NOT crash; subsequent state changes
  are still ignored gracefully (the form continues to render)
