# Delta spec for: fmd-ring-trigger

## MODIFIED Requirements

### Requirement: Ring state changes trigger the FMD ring command
The adapter SHALL dispatch a ring command to the FMD server when a
user sets any state matching
`0_userdata.0.FindMyDevice.ring.<id>` to `true` with `ack === false`,
and SHALL then reset the state to `false` with `ack === true`.

The dispatch path is `onStateChange(id, state)` in `src/main.ts`:
match the ID against the regex `^0_userdata\.0\.FindMyDevice\.ring\.(.+)$`,
check `state.val === true && state.ack === false`, and call
`this.triggerRing(deviceId)`.

The ring command SHALL be signed in the format the FMD server
expects (see `fmd-ring-signing` capability): the signature SHALL be
over `${unixTime}:${data}`, not `${data}:${unixTime}`. The signed
payload is built in `FmdApi.sendRingCommand` and is the only place
in the adapter source that formats the FMD command signature
message.

#### Scenario: Manually created state, set to true
- **WHEN** the user creates a state
  `0_userdata.0.FindMyDevice.ring.<some-id>` in the ioBroker Objects
  tab (via `setObject` from `0_userdata.0`)
- **AND** sets the state value to `true` (with `ack === false`)
- **THEN** the adapter's `onStateChange` callback is invoked with
  the matching ID
- **AND** the adapter logs `Ring state triggered for device: <some-id>`
- **AND** the adapter calls `FmdApi.sendRingCommand("<some-id>")`
- **AND** `FmdApi.sendRingCommand` signs the string
  `<unixTime>:ring:<some-id>` and posts it to `POST /api/v1/command`
- **AND** the FMD server accepts the request, stores the pending
  command, and pushes a ring to the phone
- **AND** the device app's `CypherUtils.verifySig` call returns
  `true` (the signature matches the `${unixTime}:${data}` message
  the device app builds locally)
- **AND** the phone rings
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
