# Delta: admin-ui

## MODIFIED Requirements

### Requirement: Test Connection button is present
The Status panel SHALL contain a `Test Connection` button. Clicking the button SHALL send a `testConnection` message to the adapter instance via the standard ioBroker `sendTo` admin mechanism. The button SHALL be implemented as a `type: "sendTo"` form item in `src-admin/schema.json5` with `command: "testConnection"`. The form item SHALL be backed by the existing `AdapterSocket.sendTo` wrapper in `src-admin/socket.ts`. The adapter-side `onMessage.testConnection` handler in `src/main.ts` is the consumer and is already implemented.

The form item MUST be present in `src-admin/schema.json5` so that the button is reachable in **both** rendering surfaces that ioBroker.admin may use for the wrench pop-up: (a) the native `jsonConfig.json5` form, where ioBroker.admin renders the built-in `ConfigSendTo` widget and displays the reply via `window.alert`; and (b) the Vite SPA at `admin/index.html` (or `index_m.html`), where the React app owns the pop-up body.

The `Test Connection` button SHALL be reachable from the wrench pop-up on ioBroker.admin 7.7.22 with js-controller 7.1.2 in the user's deployment (the native jsonConfig form is the surface these versions render; see `docs/admin-ui.md` §"Known limitation" for the iframe-vs-native decision).

In the iframe path, `App.tsx` MAY additionally render its own custom `Test Connection` button outside the `JsonConfig` component to support the inline `Last Test Result: <msg> at HH:MM:SS` formatting and the 12-second `Promise.race` timeout. When the custom button is present alongside the schema item, the two MUST be coordinated so the user sees exactly one clickable button and one inline result line per pop-up.

#### Scenario: Successful test in the native form
- **WHEN** the user opens the wrench pop-up on admin 7.7.22 (native jsonConfig form)
- **AND** clicks the `Test Connection` button rendered by the `type: "sendTo"` form item
- **AND** the adapter can reach the FMD server with the configured credentials
- **THEN** the adapter's `sendTo` reply (`{ success: true, message: "Connected successfully" }`) is shown to the user
- **AND** the adapter's `info.connection` transitions to `true` as a side-effect
- **AND** clicking the button resolves within 5 s under normal network conditions

#### Scenario: Successful test in the iframe path
- **WHEN** the user opens the wrench pop-up on an admin version that loads the Vite SPA in an iframe
- **AND** clicks the `Test Connection` button (rendered by the schema item or by `App.tsx`'s custom button)
- **AND** the adapter can reach the FMD server with the configured credentials
- **THEN** the panel shows `Last Test Result: OK – connected at HH:MM:SS` below the `Last Error` field
- **AND** the click resolves within 5 s under normal network conditions
- **AND** the adapter's `info.connection` transitions to `true` as a side-effect

#### Scenario: Failed test in the native form
- **WHEN** the user clicks `Test Connection` in the native form
- **AND** the adapter cannot reach the FMD server (wrong credentials, DNS failure, TLS error, 4xx, 5xx)
- **THEN** the adapter's `sendTo` reply (`{ error: "<reason>" }`) is shown to the user
- **AND** the form remains editable (the failure does not disable the Save button)

#### Scenario: Failed test in the iframe path
- **WHEN** the user clicks `Test Connection` in the iframe path
- **AND** the adapter cannot reach the FMD server
- **THEN** the panel shows `Last Test Result: Failed – <reason> at HH:MM:SS` below the `Last Error` field
- **AND** `Last Error` is also updated by the polling loop to reflect the same failure
- **AND** the form remains editable (the failure does not disable the Save button)

#### Scenario: Click while no socket is available
- **WHEN** the host admin's `socket.io.js` did not load (`AdapterSocket.isLive === false`)
- **THEN** the `Test Connection` button is rendered but disabled (or shows a tooltip / inline error explaining the missing socket)
- **AND** the "Live data unavailable" banner remains visible

#### Scenario: User sees exactly one Test Connection button per pop-up
- **WHEN** the pop-up is rendered in the iframe path with both the schema item and `App.tsx`'s custom button present
- **THEN** exactly one clickable `Test Connection` button is visible to the user
- **AND** exactly one `Last Test Result` line is visible to the user

### Requirement: Last test result is visible next to Last Error
The Status panel SHALL render a "Last Test Result" line directly below the `Last Error` field.

In the **iframe path** (Vite SPA at `admin/index.html`), the line SHALL show the most recent `testConnection` reply in a human-readable form:

- Success: `OK – connected at HH:MM:SS`
- Failure: `Failed – <error message> at HH:MM:SS`

The line SHALL default to `(click Test Connection to run)` until the first click.

The line SHALL be implemented as a `type: "staticText"` form item in `src-admin/schema.json5` whose value is pushed into the `data` prop by `App.tsx`. The App SHALL use a `useState<string>` (or equivalent) to hold the latest formatted result and update it from the `sendTo` reply returned by the `type: "sendTo"` form item, or by directly calling `socket.sendTo(...)` from a custom handler and using the resolved promise.

In the **native form** (ioBroker.admin 7.7.22 with the native jsonConfig renderer), the `ConfigSendTo` widget displays the reply via `window.alert`. The "Last Test Result" `staticText` line SHALL remain in the schema and SHALL continue to show the placeholder `(click Test Connection to run)` in the native form. The `App.tsx` polling loop SHALL NOT clear the line in the native form (since `App.tsx` is not running there, the staticText value remains whatever the schema default is).

#### Scenario: Default state on first load (iframe path)
- **WHEN** the user opens the wrench pop-up in the iframe path and has not yet clicked `Test Connection`
- **THEN** the `Last Test Result` line shows `(click Test Connection to run)`

#### Scenario: Default state on first load (native form)
- **WHEN** the user opens the wrench pop-up in the native form and has not yet clicked `Test Connection`
- **THEN** the `Last Test Result` line shows `(click Test Connection to run)`
- **AND** no console errors are emitted by the staticText rendering

#### Scenario: Result updates after a click in the iframe path
- **WHEN** the user clicks `Test Connection` in the iframe path and the reply resolves
- **THEN** within 1 s the `Last Test Result` line reflects the reply (success or failure message + timestamp)
- **AND** the timestamp is the local browser time formatted as `HH:MM:SS`

#### Scenario: Result survives a polling cycle in the iframe path
- **WHEN** the user clicks `Test Connection` successfully in the iframe path
- **AND** the next 5 s polling cycle runs
- **THEN** the `Last Test Result` line is NOT cleared by the polling cycle (the live `info.lastError` is still empty)
- **AND** `info.connection` continues to show `true`

#### Scenario: Result is cleared by a fresh runtime error in the iframe path
- **WHEN** a successful `Test Connection` result is displayed in the iframe path
- **AND** the adapter subsequently sets `info.lastError` to a non-empty string (e.g. a network blip 30 s later)
- **THEN** the `Last Test Result` line is cleared within 5 s (one polling cycle)
- **AND** only the live `Last Error` field shows the new error
