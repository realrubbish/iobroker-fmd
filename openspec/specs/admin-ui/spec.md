# Capability: admin-ui

## Purpose

TBD

## Requirements

### Requirement: Wrench pop-up renders the config form
When a user clicks the wrench icon on the `iobroker-fmd.0` instance row in ioBroker.admin 7.7.22, the system SHALL render the adapter's config form (not a 404). The form SHALL be hosted inside the iframe that the admin SPA loads from `admin/index.html` (or `admin/index_m.html` for materialize users) and SHALL be reachable at `http://<host>:8081/adapter/iobroker-fmd/index.html?<instance>&newReact=true&<instance>&react=<theme>`.

#### Scenario: Wrench pop-up loads without 404
- **WHEN** a user clicks the wrench icon on the `iobroker-fmd.0` instance row
- **THEN** the browser requests `admin/index.html` (or `admin/index_m.html`) and receives HTTP 200
- **AND** the iframe renders the config form (not a blank page or an admin error)

#### Scenario: Materialize users get index_m.html
- **WHEN** the ioBroker.admin host has `materialize` enabled
- **THEN** the iframe loads `admin/index_m.html` instead of `admin/index.html`

### Requirement: Form is driven by jsonConfig.json5
The config form SHALL be rendered from `admin/jsonConfig.json5`. The build step SHALL produce a JavaScript bundle that, when executed inside the ioBroker.admin iframe, mounts the `JsonConfig` component from `@iobroker/json-config` and passes `jsonConfig.json5` as its schema. `admin/settings.json` SHALL be kept on disk for backward compatibility but SHALL NOT be the source of truth for the rendered form.

#### Scenario: jsonConfig is loaded at runtime
- **WHEN** `admin/index.html` boots inside the iframe
- **THEN** it fetches `admin/jsonConfig.json5`
- **AND** passes the parsed schema to the `JsonConfig` component
- **AND** the component renders the form fields described in that schema

#### Scenario: settings.json is not consulted
- **WHEN** the iframe is rendered
- **THEN** no request to `admin/settings.json` is required for the form to display

### Requirement: Connection panel collects three required fields
The Connection panel SHALL contain exactly three editable fields: `serverUrl` (text, must match `^https://.*`), `username` (text, required), and `password` (password, required, writeOnly). The values SHALL be persisted via the standard ioBroker object update API for `system.adapter.iobroker-fmd.0` (native config). Saving SHALL restart the adapter.

#### Scenario: User saves valid connection details
- **WHEN** the user enters a valid `serverUrl` (https), `username`, and `password`
- **AND** clicks Save
- **THEN** the native config for `system.adapter.iobroker-fmd.0` is updated
- **AND** the adapter instance restarts

#### Scenario: Invalid serverUrl is rejected
- **WHEN** the user enters a `serverUrl` that does not start with `https://`
- **THEN** the Save action is blocked with a validation message

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

### Requirement: Devices panel shows runtime ring state
The Devices panel SHALL list the device IDs currently registered under `0_userdata.0.FindMyDevice.ring.*` and SHALL show the latest known ring state for each. The panel SHALL be read-only and SHALL update at least every 5 seconds without a full iframe reload.

#### Scenario: Device list reflects current 0_userdata state
- **WHEN** the user has created states `0_userdata.0.FindMyDevice.ring.<id1>` and `0_userdata.0.FindMyDevice.ring.<id2>`
- **THEN** the Devices panel lists both IDs with their current boolean state

#### Scenario: Empty device list
- **WHEN** no states exist under `0_userdata.0.FindMyDevice.ring.*`
- **THEN** the Devices panel shows an empty-state message ("No devices configured. Create states under 0_userdata.0.FindMyDevice.ring.<deviceId>.")

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

### Requirement: ringDeviceId and buttonStateId are configurable from the UI
The form SHALL expose two additional optional fields: `ringDeviceId` (text) and `buttonStateId` (text). These SHALL be persisted to the adapter's native config and SHALL be read by `src/main.ts` to control the hardware-button trigger path (currently `BUTTON_STATE_ID` is hardcoded in `main.ts`).

#### Scenario: User configures a custom buttonStateId
- **WHEN** the user enters a custom Shelly state ID into the `buttonStateId` field and saves
- **THEN** the runtime reads the new value from `this.config.buttonStateId` instead of the hardcoded constant

#### Scenario: User configures a default ringDeviceId
- **WHEN** the user enters a device ID into the `ringDeviceId` field and saves
- **THEN** triggering a `triple_push` event on the configured `buttonStateId` calls `triggerRing(config.ringDeviceId)`

### Requirement: Iframe works without an external network at runtime
The form SHALL be fully functional after a single HTTP page load. The React app, the `@iobroker/json-config` component, and all CSS SHALL be served from the adapter's own `admin/` folder as Vite-built assets. The socket.io client SHALL be loaded at runtime via a `<script src="/adapter/iobroker/admin/lib/js/socket.io.js">` tag in `index.html` (or `index_m.html`). The form SHALL NOT depend on CDNs, third-party hosts, or browser network access beyond the ioBroker admin host.

#### Scenario: Offline operation
- **WHEN** the host running the browser is offline
- **AND** the user opens the wrench pop-up
- **THEN** the form still renders and is editable

#### Scenario: Socket script fails to load
- **WHEN** the global `window.io` is undefined because the `<script>` tag failed to load
- **THEN** the form still renders in a read-only state
- **AND** the Status and Devices panels show a "live data unavailable" message
- **AND** the form fields are still editable, but Save is disabled
