## MODIFIED Requirements

### Requirement: Test Connection button is present
The Status panel SHALL contain a `Test Connection` button. Clicking the button SHALL send a `testConnection` message to the adapter instance via the standard ioBroker `sendTo` admin mechanism and SHALL show the result inline (success / failure with message) in a dedicated "Last Test Result" line directly below the `Last Error` field.

The button SHALL be implemented as a `type: "sendTo"` form item in `src-admin/schema.json5` with `command: "testConnection"`. The form item SHALL be backed by the existing `AdapterSocket.sendTo` wrapper in `src-admin/socket.ts`. The adapter-side `onMessage.testConnection` handler in `src/main.ts` is the consumer and is already implemented.

#### Scenario: Successful test
- **WHEN** the user clicks `Test Connection`
- **AND** the adapter can reach the FMD server with the configured credentials
- **THEN** the panel shows `Last Test Result: OK – connected at HH:MM:SS` below the `Last Error` field
- **AND** the click resolves within 5 s under normal network conditions
- **AND** the adapter's `info.connection` transitions to `true` as a side-effect

#### Scenario: Failed test
- **WHEN** the user clicks `Test Connection`
- **AND** the adapter cannot reach the FMD server (wrong credentials, DNS failure, TLS error, 4xx, 5xx)
- **THEN** the panel shows `Last Test Result: Failed – <reason> at HH:MM:SS` below the `Last Error` field
- **AND** `Last Error` is also updated by the polling loop to reflect the same failure
- **AND** the form remains editable (the failure does not disable the Save button)

#### Scenario: Click while no socket is available
- **WHEN** the host admin's `socket.io.js` did not load (`AdapterSocket.isLive === false`)
- **THEN** the `Test Connection` button is rendered but disabled (or shows a tooltip / inline error explaining the missing socket)
- **AND** the "Live data unavailable" banner remains visible

### Requirement: Status reflects an error
The Status panel SHALL display the current value of `info.connection` and `info.lastError` for the `iobroker-fmd.0` instance. The panel SHALL be read-only. Values SHALL update at least every 5 seconds without a full iframe reload.

The "Last Test Result" line SHALL be cleared (replaced with a `–` placeholder or removed) on the next polling cycle in which a fresh non-empty `info.lastError` is observed, so the user is not misled by a stale "OK" while the live state is now failing.

#### Scenario: Status reflects a healthy connection
- **WHEN** the adapter is running and authenticated against the FMD server
- **THEN** the Status panel shows a "connected" indicator derived from `info.connection === true`

#### Scenario: Status reflects an error
- **WHEN** the adapter has set `info.lastError` to a non-empty string
- **THEN** the Status panel shows that string in the "Last Error" field
- **AND** if a `Last Test Result` line was previously showing `OK – connected …`, that line is cleared within 5 s (one polling cycle)

## ADDED Requirements

### Requirement: Last test result is visible next to Last Error
The Status panel SHALL render a "Last Test Result" line directly below the `Last Error` field. The line SHALL show the most recent `testConnection` reply in a human-readable form:

- Success: `OK – connected at HH:MM:SS` (or a localized equivalent)
- Failure: `Failed – <error message> at HH:MM:SS`

The line SHALL default to `(click Test Connection to run)` until the first click.

The line SHALL be implemented as a `type: "staticText"` form item in `src-admin/schema.json5` whose value is pushed into the `data` prop by `App.tsx`. The App SHALL use a `useState<string>` (or equivalent) to hold the latest formatted result and update it from the `sendTo` reply passed back by the `type: "sendTo"` form item, or — if `JsonConfig` does not expose a reply callback — by directly calling `socket.sendTo(...)` from a custom handler and using the resolved promise.

#### Scenario: Default state on first load
- **WHEN** the user opens the wrench pop-up and has not yet clicked `Test Connection`
- **THEN** the `Last Test Result` line shows `(click Test Connection to run)`

#### Scenario: Result updates after a click
- **WHEN** the user clicks `Test Connection` and the reply resolves
- **THEN** within 1 s the `Last Test Result` line reflects the reply (success or failure message + timestamp)
- **AND** the timestamp is the local browser time formatted as `HH:MM:SS`

#### Scenario: Result survives a polling cycle
- **WHEN** the user clicks `Test Connection` successfully
- **AND** the next 5 s polling cycle runs
- **THEN** the `Last Test Result` line is NOT cleared by the polling cycle (the live `info.lastError` is still empty)
- **AND** `info.connection` continues to show `true`

#### Scenario: Result is cleared by a fresh runtime error
- **WHEN** a successful `Test Connection` result is displayed
- **AND** the adapter subsequently sets `info.lastError` to a non-empty string (e.g. a network blip 30 s later)
- **THEN** the `Last Test Result` line is cleared within 5 s (one polling cycle)
- **AND** only the live `Last Error` field shows the new error
