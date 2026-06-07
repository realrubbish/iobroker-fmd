## ADDED Requirements

### Requirement: Device listing
The adapter SHALL retrieve the list of available FMD devices from the FMD server.

#### Scenario: Fetch devices successfully
- **WHEN** adapter has valid authentication tokens
- **THEN** it SHALL request device list from `/api/v1/devices` with signed request
- **AND** SHALL create states for each device under `iobroker-fmd.0.devices.<deviceId>`

#### Scenario: Device list includes device metadata
- **WHEN** device list is retrieved
- **THEN** each device SHALL include `name`, `type`, and `lastRing` timestamp

### Requirement: Ring command execution
The adapter SHALL send a ring command to a specified FMD device.

#### Scenario: Ring command with valid authentication
- **WHEN** user triggers ring for a device
- **THEN** adapter SHALL send signed request to `/api/v1/command` with `ring:<deviceId>` command
- **AND** FMD server SHALL send ntfy push to the device

#### Scenario: Ring command updates lastRing timestamp
- **WHEN** ring command is sent successfully
- **THEN** the device's `lastRing` state SHALL be updated to current timestamp

### Requirement: State-based ring trigger
The adapter SHALL subscribe to button state changes and trigger ring when configured trigger occurs.

#### Scenario: Hardware button triggers ring
- **WHEN** button state `shelly.0.shellyplus1pm#cc7b5c837250#1.Input0.Event` changes to `triple_push`
- **THEN** adapter SHALL send ring command to the configured device

#### Scenario: Software button via sendTo triggers ring
- **WHEN** adapter receives `sendTo('iobroker-fmd.0', 'ring', { deviceId: 'xxx' })`
- **THEN** adapter SHALL send ring command to the specified device

### Requirement: RSA-PSS request signing
The adapter SHALL sign all API requests using RSA-PSS with the user's private key.

#### Scenario: Sign request with private key
- **WHEN** any API request is made to FMD server
- **THEN** adapter SHALL sign the request data using RSA-PSS-SHA256 with the private key
- **AND** include signature in `CmdSig` header field

#### Scenario: Request structure for ring command
- **WHEN** ring command is sent
- **THEN** request SHALL include:
  - `IDT`: Access token
  - `Data`: Command string (e.g., `ring:device123`)
  - `UnixTime`: Current timestamp in milliseconds
  - `CmdSig`: Base64-encoded RSA-PSS signature of `Data:UnixTime`

### Requirement: Ring state in userdata
The adapter SHALL expose ring states under `0_userdata.0.FindMyDevice` for external control.

#### Scenario: Device ring state exists
- **WHEN** devices are listed
- **THEN** adapter SHALL create `0_userdata.0.FindMyDevice.ring.<deviceId>` state for each device
- **AND** state SHALL be writable to allow triggering from vis-2 or scripts

#### Scenario: Ring state accepts trigger
- **WHEN** `0_userdata.0.FindMyDevice.ring.<deviceId>` is set to `true`
- **THEN** adapter SHALL send ring command to that device
- **AND** reset state back to `false` after command is sent
