## Context

The FMD adapter needs to implement the ring functionality to locate devices via ntfy push notifications. The FMD server requires RSA-PSS signed API requests for all commands.

The `configuration` change established the authentication flow, but the ring command requires:
1. Listing devices to know which devices can be rung
2. Signing requests with the user's private key
3. Sending the ring command with proper request format
4. Triggering ring via hardware button (MQTT subscription) or software button (vis-2 state)

Constraints:
- FMD API requires RSA-PSS-SHA256 signatures
- Request format: `Data:UnixTime` concatenated, then signed
- Ring command format: `ring:<deviceId>`
- Private key from authentication flow is stored in memory only

## Goals / Non-Goals

**Goals:**
- List FMD devices and create ioBroker states for each
- Send signed ring commands to FMD server
- Support hardware button trigger (MQTT state subscription)
- Support software button trigger (vis-2 state write or sendTo)
- Update device lastRing timestamp after successful ring

**Non-Goals:**
- Implementing device pairing/provisioning (FMD app handles this)
- Battery status monitoring (not in FMD API for ring devices)
- Multiple device selection for simultaneous ring

## Decisions

### Decision: Use Web Crypto API for RSA-PSS signing
**Chosen:** Use browser-compatible `crypto.subtle` for signing

**Rationale:**
- Works in Node.js 18+ and browser environments
- No additional npm packages needed
- Standard Web Crypto API is well-documented

**Alternatives considered:**
- `crypto` module (Node.js only): Works but less portable
- `node-forge`: Additional dependency, larger bundle
- Custom implementation: Security risk

### Decision: Ring state per device under `0_userdata.0.FindMyDevice`
**Chosen:** Create writable state for each discovered device in userdata namespace

**Rationale:**
- `0_userdata.0` is designed for user-defined objects and scripts
- vis-2 and other adapters can easily write to these states
- Each device has its own trigger state
- Natural mapping to FMD device IDs

**Alternatives considered:**
- `iobroker-fmd.0.ring.<deviceId>`: Adapter namespace, not ideal for user-defined triggers
- Single ring state with deviceId parameter: More complex vis-2 binding
- Only sendTo interface: Less flexible for vis-2 native widgets

### Decision: Lazy device listing (on adapter ready, not on ring trigger)
**Chosen:** Fetch device list once when adapter starts

**Rationale:**
- Devices don't change frequently
- Faster ring response (no API call needed)
- Reduces server load

**Alternatives considered:**
- Fetch on each ring: Unnecessary API call, slower response
- Polling for device changes: Overkill, devices are stable

### Decision: Subscribe to button state via ioBroker state subscription
**Chosen:** Monitor button state changes in `onStateChange`

**Rationale:**
- ioBroker already subscribes to MQTT states
- Adapter receives state changes automatically
- Simple to configure trigger conditions

**Alternatives considered:**
- Direct MQTT subscription: Would bypass ioBroker MQTT adapter
- Polling: Less efficient, more complex

## Risks / Trade-offs

[Risk] RSA-PSS signing may fail on very old Node.js versions
→ **Mitigation:** Require Node.js >=18 (Web Crypto API stable)

[Risk] Device ID format may change between FMD versions
→ **Mitigation:** Log device ID on first fetch for debugging

[Risk] Button trigger configuration is hardcoded
→ **Mitigation:** Make trigger state ID configurable in future

## Migration Plan

1. User updates adapter
2. Adapter fetches device list on startup
3. Ring states appear under `0_userdata.0.FindMyDevice.ring.<deviceId>`
4. User configures vis-2 button to write to ring state
5. Button press → state change → ring command → device rings

**Rollback:** Downgrade adapter - ring states disappear, button triggers stop working.

## Open Questions

- Should we expose device selection in admin UI (which device to ring on button press)?
- Do we need to debounce rapid button presses?
- Should lastRing timestamp be exposed as a readable state for vis-2 display?
