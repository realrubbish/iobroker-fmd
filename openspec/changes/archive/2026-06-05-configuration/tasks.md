## 1. Adapter Configuration Schema

- [x] 1.1 Add FMD server configuration fields to `io-package.json` native section (endpoint, username, password)
- [x] 1.2 Mark password field with `encryptedNative: ["native.password"]` for secure storage
- [x] 1.3 Add JSON schema validation for endpoint URL (must be HTTPS)
- [x] 1.4 Add connection status state to adapter info object

## 2. FMD Authentication Module

- [x] 2.1 Create `src/lib/fmd-auth.ts` module with FmdAuth class
- [x] 2.2 Implement `getSalt()` - retrieve salt from `/api/v1/auth/salt`
- [x] 2.3 Implement `deriveKey()` - Argon2id key derivation with username, password, salt
- [x] 2.4 Implement `login()` - exchange derived key for access token via `/api/v1/auth/login`
- [x] 2.5 Implement `getPrivateKey()` - retrieve private key using access token from `/api/v1/auth/key`
- [x] 2.6 Implement `refreshToken()` - refresh expired access token using private key
- [x] 2.7 Add token caching in memory with expiry handling

## 3. Adapter Settings UI

- [x] 3.1 Add settings.json for admin UI configuration form
- [x] 3.2 Add FMD Server section with endpoint URL input field
- [x] 3.3 Add username and password input fields
- [x] 3.4 Add connection status indicator (text display of current state)
- [x] 3.5 Add "Test Connection" button to validate settings
- [x] 3.6 Add validation messages for missing/invalid fields

## 4. Adapter Integration

- [x] 4.1 Import FmdAuth class in adapter main.ts
- [x] 4.2 Initialize FmdAuth with configuration from adapter settings
- [x] 4.3 Wire up "Test Connection" button to auth flow
- [x] 4.4 Update connection status after successful/failed authentication
- [x] 4.5 Add error logging for auth failures
- [x] 4.6 Ensure lazy auth triggers on first ring API call

## 5. Testing

- [x] 5.1 Test credential encryption/decryption roundtrip
- [x] 5.2 Test authentication flow with valid FMD server
- [x] 5.3 Test connection status updates
- [x] 5.4 Test validation errors for invalid endpoint URL
- [x] 5.5 Test token refresh scenario
