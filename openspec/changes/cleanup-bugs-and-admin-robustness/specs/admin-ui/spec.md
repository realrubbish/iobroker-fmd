# Capability: admin-ui (delta)

## MODIFIED Requirements

### Requirement: Status reflects an error
The Status panel SHALL display the current value of `info.connection` and `info.lastError` for the `iobroker-fmd.0` instance. The panel SHALL be read-only. Values SHALL update at least every 5 seconds without a full iframe reload.

The "Last Test Result" line SHALL be cleared (replaced with the placeholder `(click Test Connection to run)`) on the next polling cycle in which the polled `info.lastError` state object's `lastChanged` (`lc`) timestamp is observed to have advanced since the previous poll. The `lc`-based detection is the fresh-error signal: a repeated error whose `lc` has NOT advanced does not clear the "Last Test Result" line; a fresh error (or the empty→non-empty transition) whose `lc` HAS advanced DOES clear it. The `lc` is the timestamp field carried by every ioBroker state object, in ms since epoch.

#### Scenario: Status reflects a healthy connection
- **WHEN** the adapter is running and authenticated against the FMD server
- **THEN** the Status panel shows a "connected" indicator derived from `info.connection === true`

#### Scenario: Status reflects an error
- **WHEN** the adapter has set `info.lastError` to a non-empty string
- **THEN** the Status panel shows that string in the "Last Error" field
- **AND** if a `Last Test Result` line was previously showing `OK – connected …`, that line is cleared within 5 s (one polling cycle)
- **AND** the clearing is driven by `info.lastError`'s `lc` advancing, not by string equality

#### Scenario: Identical error string repeated
- **WHEN** a "Last Test Result: OK – connected at HH:MM:SS" line is displayed
- **AND** the adapter sets `info.lastError` to a string that is byte-identical to the previously observed error
- **AND** the new error's `lc` is different from the previously observed error's `lc`
- **THEN** the "Last Test Result" line IS cleared (because `lc` advanced)
- **AND** the "Last Error" field shows the new error

#### Scenario: Identical error string with unchanged lc
- **WHEN** the polled `info.lastError` state object is returned with the same `lc` as the previous poll
- **THEN** the "Last Test Result" line is NOT cleared (no fresh transition)

### Requirement: Test Connection button is present
The Status panel SHALL contain a `Test Connection` button. Clicking the button SHALL send a `testConnection` message to the adapter instance via `socket.sendTo(...)` (the `AdapterSocket.sendTo` wrapper in `src-admin/socket.ts`) and SHALL show the result inline (success / failure with message) in a dedicated "Last Test Result" line directly below the `Last Error` field.

The button SHALL be implemented as a real React `<button>` rendered by `App.tsx` (not as a `type: "sendTo"` JsonConfig form item). The adapter-side `onMessage.testConnection` handler in `src/main.ts` is the consumer.

The button SHALL enforce a client-side timeout of 12 seconds on the `socket.sendTo(...)` Promise. On timeout the button SHALL:
1. Re-enable itself (set the `testRunning` state to `false`).
2. Format the `Last Test Result` line as `Failed – timed out after 12s at HH:MM:SS`.
3. Log the timeout at the `warn` level for in-browser console diagnostics.

The 12-second budget SHALL be a constant in `src-admin/App.tsx` (e.g. `const TEST_CONNECTION_TIMEOUT_MS = 12_000;`), tuned to cover Pi-class hardware (Argon2id × 2 + 2× HTTP round-trip + AES-GCM unwrap + buffer) with a ~2× safety margin over the dev-host worst-case.

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

#### Scenario: Adapter hangs and times out
- **WHEN** the user clicks `Test Connection`
- **AND** the adapter is unreachable, in a state where the `testConnection` handler does not reply, or the `socket.sendTo(...)` Promise otherwise does not resolve
- **THEN** the button does NOT remain in "Testing…" indefinitely
- **AND** within 12 s the panel shows `Last Test Result: Failed – timed out after 12s at HH:MM:SS`
- **AND** the button is re-enabled so the user can click again
- **AND** the click that triggered the timeout is logged at the `warn` level in the browser console

#### Scenario: Click while no socket is available
- **WHEN** the host admin's `socket.io.js` did not load (`AdapterSocket.isLive === false`)
- **THEN** the `Test Connection` button is rendered but disabled (or shows a tooltip / inline error explaining the missing socket)
- **AND** the "Live data unavailable" banner remains visible
