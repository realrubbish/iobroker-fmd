# Delta: admin-ui

## MODIFIED Requirements

### Requirement: Ring Device button is present
The Status panel SHALL contain a `Ring Device` button. Clicking the button SHALL send a `ring` message to the adapter instance via the standard ioBroker `sendTo` admin mechanism. The message payload SHALL be `{ deviceId: <configured ringDeviceId> }` so the adapter's `onMessage.ring` handler in `src/main.ts:505-555` dispatches the ring to the right device. The reply (`{ success, message }` or `{ error }`) is shown via the standard `ConfigSendTo` widget reply mechanism (`window.alert`).

The button SHALL be implemented as a `type: "sendTo"` form item in `src-admin/schema.json5` with `command: "ring"` and an empty `payload` (the SPA reads `config.ringDeviceId` from the existing form data and passes it as the message payload; the native widget on admin 7.7.22 does not let the schema item carry a computed payload, so the payload is constructed at click time). The form item SHALL be backed by the existing `AdapterSocket.sendTo` wrapper in `src-admin/socket.ts`.

The button SHALL be reachable from the wrench pop-up on ioBroker.admin 7.7.22 (the deployed form surface for this change's verification target — see `docs/admin-ui.md` §"Known limitation" for the admin-7.7.22-vs-iframe-path note).

In the iframe path (Vite SPA at `admin/index.html`), `App.tsx` MAY additionally render its own custom `Ring Device` button outside the `JsonConfig` component to support the inline `Last Ring Result: <msg> at HH:MM:SS` formatting and a future timeout. When the custom button is present alongside the schema item, the two MUST be coordinated so the user sees exactly one clickable button.

#### Scenario: Successful ring in the native form
- **WHEN** the user opens the wrench pop-up on admin 7.7.22 (native jsonConfig form)
- **AND** `Default Ring Device` is set to a non-empty deviceId
- **AND** clicks the `Ring Device` button rendered by the `type: "sendTo"` form item
- **THEN** the adapter's `sendTo` reply (`{ success: true, message: "Ring command sent to <deviceId>" }`) is shown to the user via `window.alert`
- **AND** the configured FMD device receives the ring command within 2 s under normal network conditions
- **AND** the adapter's `info.connection` remains `true` as a side-effect

#### Scenario: Successful ring in the iframe path
- **WHEN** the user opens the wrench pop-up on an admin version that loads the Vite SPA in an iframe
- **AND** `Default Ring Device` is set to a non-empty deviceId
- **AND** clicks the `Ring Device` button (rendered by the schema item or by `App.tsx`'s custom button)
- **THEN** the configured FMD device receives the ring command within 2 s
- **AND** the inline `Last Ring Result: OK – rang at HH:MM:SS` line below `Last Error` reflects the reply (success or failure message + timestamp) within 1 s

#### Scenario: Failed ring (no deviceId configured)
- **WHEN** the user clicks `Ring Device` with `Default Ring Device` empty
- **THEN** the adapter's `sendTo` reply is shown via `window.alert` with an error message explaining that a deviceId is required
- **AND** no FMD device receives a ring command
- **AND** the form remains editable

#### Scenario: Failed ring (adapter unreachable)
- **WHEN** the user clicks `Ring Device` and the adapter cannot reach the FMD server
- **THEN** the adapter's `sendTo` reply (`{ error: "<reason>" }`) is shown via `window.alert`
- **AND** no FMD device receives a ring command
- **AND** the form remains editable (the failure does not disable the Save button)

#### Scenario: Click while no socket is available
- **WHEN** the host admin's `socket.io.js` did not load (`AdapterSocket.isLive === false`)
- **THEN** the `Ring Device` button is rendered but disabled (or shows a tooltip / inline error explaining the missing socket)
- **AND** the "Live data unavailable" banner remains visible

#### Scenario: User sees exactly one Ring Device button per pop-up
- **WHEN** the pop-up is rendered in the iframe path with both the schema item and `App.tsx`'s custom button present
- **THEN** exactly one clickable `Ring Device` button is visible to the user
- **AND** exactly one `Last Ring Result` line is visible to the user (or no such line, in the native form)

## REMOVED Requirements

### Requirement: Last test result is visible next to Last Error
**Reason**: The `Test Connection` button was the wrong action for a pop-up that already exposes the adapter's `info.connection` state and supports the `npm run auth:smoke` script for credential verification. The pop-up is now anchored on the ring trigger, which is the most common operation. The auth-check UX is better served by the runtime state + the smoke test than by a dedicated button.

**Migration**: For credential verification, run `npm run auth:smoke` against the dev FMD server. For live auth status, read `iobroker-fmd.0.info.connection`. No replacement UI needed.
