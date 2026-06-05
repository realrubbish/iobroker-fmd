## Why

The FMD adapter can now connect to the FMD server via the `configuration` change, but it cannot yet ring devices. Users need to trigger device rings via hardware buttons (Shelly MQTT) or software buttons (vis-2) to locate their devices via ntfy push notifications.

## What Changes

- Add ring command API endpoint integration
- Implement RSA-PSS request signing for authenticated API calls
- Add device listing to discover available FMD devices
- Add state-based ring trigger (subscribe to button events)
- Add software ring trigger via `sendTo` message
- Create `fmd.0.ring.<deviceId>` states for each device
- Add ring state to admin UI showing last ring time

## Capabilities

### New Capabilities
- `fmd-ring`: Ring FMD devices via API. Handles:
  - RSA-PSS signed API request generation
  - Ring command sending to `/api/v1/command`
  - Device listing from `/api/v1/devices`
  - State-based ring triggers (hardware button via MQTT, software via vis-2)

### Modified Capabilities
- None

## Impact

- New `src/lib/fmd-api.ts` module for signed API requests
- Modified `src/main.ts` to handle ring commands and device listing
- New states: `fmd.0.devices.<id>` for each FMD device
- New states: `fmd.0.ring.<deviceId>` to trigger ring from vis-2
- Uses existing `FmdAuth` from configuration change
