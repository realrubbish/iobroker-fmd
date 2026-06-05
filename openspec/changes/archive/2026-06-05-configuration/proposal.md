## Why

The ioBroker FMD adapter needs to connect to an FMD server to ring devices via ntfy. Currently there is no way to configure the FMD server connection (endpoint URL, credentials, authentication flow) in the adapter settings. Without this, the adapter cannot communicate with FMD server to trigger device rings.

## What Changes

- Add FMD server configuration section to adapter settings
- Implement secure credential storage using `encryptedNative` for password
- Add multi-step authentication flow: Salt → Argon2id → Access Token → Private Key
- Add connection status indicator and validation
- Support configuring the FMD server endpoint URL

## Capabilities

### New Capabilities
- `fmd-server-connection`: FMD server connection and authentication configuration. Handles:
  - Server endpoint URL configuration
  - Username/password credential storage with encryption
  - Multi-step authentication (Salt retrieval → Argon2id derivation → Access token exchange → Private key decryption)
  - Session token management and refresh
  - Connection status and health checking

### Modified Capabilities
- None

## Impact

- New adapter configuration panel section for FMD server settings
- Affects `io-package.json` (adapter configuration schema)
- New TypeScript module for FMD authentication API calls
- Credentials stored via ioBroker's `encryptedNative` mechanism
