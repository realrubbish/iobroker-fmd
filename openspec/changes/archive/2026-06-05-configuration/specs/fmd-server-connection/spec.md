## ADDED Requirements

### Requirement: Server endpoint configuration
The adapter SHALL allow configuration of the FMD server endpoint URL via adapter settings.

#### Scenario: Configure valid server endpoint
- **WHEN** user enters a valid HTTPS URL (e.g., `https://fmd.schnurri.ch`) in adapter settings
- **THEN** the adapter SHALL store the endpoint URL and use it for all FMD API calls

#### Scenario: Invalid endpoint URL is rejected
- **WHEN** user enters an invalid URL (non-HTTPS, malformed) in adapter settings
- **THEN** the adapter SHALL display a validation error and not save the configuration

### Requirement: Credential storage with encryption
The adapter SHALL securely store FMD server credentials using ioBroker's `encryptedNative` mechanism.

#### Scenario: Password is encrypted at rest
- **WHEN** user enters username and password in adapter settings
- **THEN** the password SHALL be encrypted using `encryptedNative` before being stored in `io-package.json`
- **AND** the encrypted password SHALL only be decrypted when needed for authentication

### Requirement: Multi-step FMD authentication
The adapter SHALL implement the FMD multi-step authentication flow: Salt → Argon2id → Access Token → Private Key.

#### Scenario: Successful authentication flow
- **WHEN** adapter needs to authenticate with FMD server
- **THEN** it SHALL first retrieve the salt from `/api/v1/auth/salt`
- **AND** then derive the key using Argon2id with username, password, and salt
- **AND** exchange the derived key for an access token via `/api/v1/auth/login`
- **AND** use the access token to retrieve the private key from `/api/v1/auth/key`

#### Scenario: Authentication token refresh
- **WHEN** the access token expires during operation
- **THEN** the adapter SHALL attempt to refresh the token using the stored private key
- **AND** if refresh fails, SHALL notify user and require re-authentication

### Requirement: Connection status indication
The adapter SHALL provide a connection status indicator showing FMD server connectivity state.

#### Scenario: Connection healthy
- **WHEN** adapter successfully authenticates and can reach FMD server
- **THEN** status indicator SHALL show "Connected" or green status

#### Scenario: Connection failed
- **WHEN** adapter cannot reach FMD server or authentication fails
- **THEN** status indicator SHALL show "Disconnected" or red status
- **AND** error details SHALL be logged for debugging

### Requirement: Configuration validation
The adapter SHALL validate FMD server configuration before attempting connection.

#### Scenario: Missing required fields
- **WHEN** user attempts to save configuration without endpoint URL or credentials
- **THEN** the adapter SHALL display a validation error listing all missing required fields

#### Scenario: Valid configuration saves successfully
- **WHEN** user provides all required configuration fields (endpoint, username, password)
- **THEN** the adapter SHALL save the configuration and display success confirmation
