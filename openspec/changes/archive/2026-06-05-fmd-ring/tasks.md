## 1. FMD API Module

- [x] 1.1 Create `src/lib/fmd-api.ts` with FmdApi class
- [x] 1.2 Implement RSA-PSS signing using Web Crypto API
- [x] 1.3 Implement `listDevices()` - GET `/api/v1/devices`
- [x] 1.4 Implement `sendRingCommand(deviceId)` - POST `/api/v1/command` with signed request

## 2. Device State Management

- [x] 2.1 Add `fetchDevices()` method to main.ts
- [x] 2.2 Create `fmd.0.devices.<deviceId>` states with metadata
- [x] 2.3 Add device type and lastRing timestamp to device states
- [x] 2.4 Add `getDevices()` method to retrieve device list

## 3. Ring State in userdata

- [x] 3.1 Create `0_userdata.0.FindMyDevice.ring.<deviceId>` writable states for each device
- [x] 3.2 Handle state writes to ring states in `onStateChange()`
- [x] 3.3 Reset ring state to `false` after sending command

## 4. Hardware Button Trigger

- [x] 4.1 Subscribe to button state `shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event`
- [x] 4.2 Detect `triple_push` trigger condition
- [x] 4.3 Send ring command to configured device on trigger
- [x] 4.4 Make button trigger state configurable in future

## 5. Software Button (sendTo) Integration

- [x] 5.1 Handle `ring` message in `onMessage()`
- [x] 5.2 Extract deviceId from message payload
- [x] 5.3 Send ring command to specified device
- [x] 5.4 Return success/error via callback

## 6. Admin UI Updates

- [x] 6.1 Add device list display in admin settings
- [x] 6.2 Show last ring time for each device
- [x] 6.3 Add "Ring Now" button per device in admin UI

## 7. Testing

- [x] 7.1 Test RSA-PSS signing with test key pair
- [x] 7.2 Test device listing with mock FMD server
- [x] 7.3 Test ring command flow
- [x] 7.4 Test state-based ring trigger
- [x] 7.5 Test sendTo interface
