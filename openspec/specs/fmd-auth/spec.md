# Capability: fmd-auth

## Purpose

TBD

## Requirements

### Requirement: Real FMD auth protocol against the v0.14.0 server
The adapter SHALL authenticate against the FMD server using the actual
endpoints and payload shapes documented in
`/Users/tschnurre/external-GIT/fmd-server` tag v0.14.0:

- `POST /salt` with `{"IDT": "<username>"}` in the body; response
  `{"IDT": "<username>", "Data": "<salt-url-safe-b64-no-padding>"}`.
- `POST /requestAccess` with
  `{"IDT": "<username>", "PasswordHash": "<phc-hash-b64-no-pad>",
   "SessionDurationSeconds": 86400}`; response
  `{"IDT": "<username>", "Data": "<access-token>"}`.
- `POST /key` with `{"IDT": "<access-token>"}` in the body; response
  `{"IDT": "<access-token>", "Data": "<pem-private-key>"}`.

The full flow SHALL be wrapped in `FmdAuth.authenticate()` and SHALL be
invoked from `onReady` via `connectAndFetchDevices()` exactly once per
adapter start.

#### Scenario: Successful authentication
- **WHEN** the adapter starts with valid `serverUrl`, `username`, and
  `password`
- **THEN** `FmdAuth.authenticate()` calls `POST /salt`, runs Argon2id
  on the returned salt + the user's password, parses the PHC-encoded
  hash, sends the hash portion to `POST /requestAccess`, then
  fetches the private key from `POST /key`
- **AND** returns an `AuthTokens` object with `accessToken` and
  `privateKey` populated
- **AND** the adapter transitions `info.connection` from `connecting`
  to `connected`
- **AND** `fetchDevices()` runs and creates the device states under
  `0_userdata.0.FindMyDevice.*`

#### Scenario: Wrong password
- **WHEN** the user enters a valid `serverUrl` and `username` but the
  wrong `password`
- **THEN** the FMD server returns `403 Access denied` from
  `POST /requestAccess`
- **AND** the adapter transitions `info.connection` to `error`
- **AND** `info.lastError` contains `Access denied`
- **AND** the adapter does NOT crash

#### Scenario: Server unreachable
- **WHEN** `serverUrl` is unreachable (DNS failure, connection
  refused, TLS error)
- **THEN** the adapter transitions `info.connection` to `error`
- **AND** `info.lastError` contains the underlying network error

### Requirement: Argon2id client-side key derivation with PHC output
The `FmdAuth.deriveKey` method SHALL:

1. Take the server-provided salt (URL-safe Base64, 16 bytes after
   decoding) and the user's plaintext password.
2. Run Argon2id with memory 64 MiB, iterations 3, parallelism 4, key
   length 32 bytes.
3. Return the **hash portion** (the 5th `$`-separated segment) of the
   PHC-encoded output string, in standard Base64 with no padding.

The method SHALL NOT use PBKDF2, scrypt, or any other KDF. The
implementation SHALL use the `argon2` npm package (or `hash-wasm` as
fallback if the native build fails).

#### Scenario: PHC string shape
- **WHEN** `deriveKey` is called with the live server's salt
  `xBO0AzG482Pze7UAd8vdqg` and a known password
- **THEN** it runs Argon2id once and returns a string with the
  following structure:
  ```
  $argon2id$v=19$m=65536,t=3,p=4$<salt-b64>$<hash-b64-no-padding>
  ```
- **AND** the returned hash portion is exactly 43 characters (32
  bytes → 43 Base64 chars, no padding)

#### Scenario: deriveKey is the only KDF
- **WHEN** the adapter source is grep'd for KDF primitives
- **THEN** the only matching call is `argon2.hash(...)` or the
  `hash-wasm` equivalent
- **AND** no `PBKDF2`, no `crypto.subtle.deriveBits({ name: "PBKDF2",
  ... })` remains in `lib/fmd-auth.ts`

### Requirement: URL-safe Base64 codec for the auth protocol
The `base64ToBytes` and `bytesToBase64` helpers in `FmdAuth` SHALL
handle both URL-safe and standard Base64:

- `base64ToBytes` auto-detects the input alphabet (`-_` vs `+/`),
  tolerates missing `=` padding, and throws a clear `Error` on
  invalid input.
- `bytesToBase64` produces standard Base64 with no `=` padding
  (matches `base64.StdEncoding.WithPadding(NoPadding)` on the server
  side).

#### Scenario: Decode URL-safe salt without padding
- **WHEN** the FMD server returns a salt like `"xBO0AzG482Pze7UAd8vdqg"`
  (22 chars, URL-safe, no padding)
- **THEN** `base64ToBytes` decodes it without throwing
- **AND** the resulting byte array is exactly 16 bytes long

#### Scenario: Decode standard Base64 still works
- **WHEN** a standard Base64 string with `+/` and `=` padding is
  passed to `base64ToBytes`
- **THEN** it decodes correctly
- **AND** the existing `bytesToBase64` output (standard Base64, no
  padding) is round-trip-stable

#### Scenario: Garbage input throws a clear error
- **WHEN** `base64ToBytes` receives a string that is neither valid
  URL-safe nor valid standard Base64 (e.g. `"!!!not-base64!!!"`)
- **THEN** it throws an `Error` whose message names the offending
  input and the failure reason
- **AND** the error propagates up to `FmdAuth.authenticate()` which
  logs it via `info.lastError`

#### Scenario: Encode PasswordHash without padding
- **WHEN** `bytesToBase64` is called with the 32-byte Argon2id output
- **THEN** it returns a 43-character standard Base64 string with no
  `=` padding (the form the FMD server's `password.go` expects)

### Requirement: Endpoint and payload shapes match the FMD server
The five `FmdAuth` methods SHALL hit the exact endpoints and payload
shapes that the FMD server v0.14.0 implements:

| Method | Endpoint | Body | Response `Data` field |
|---|---|---|---|
| `getSalt` | `POST /salt` | `{"IDT": "<username>"}` | URL-safe Base64 salt |
| `login` | `POST /requestAccess` | `{"IDT", "PasswordHash", "SessionDurationSeconds": 86400}` | access token |
| `getPrivateKey` | `POST /key` | `{"IDT": "<accessToken>"}` | PEM-encoded private key |
| `refreshToken` | `POST /requestAccess` | `{"IDT", "PasswordHash", "SessionDurationSeconds": <bumped>}` | new access token |

The adapter SHALL NOT use `GET /api/v1/auth/salt`, `POST
/api/v1/auth/login`, `GET /api/v1/auth/key`, or any path with
`/api/v1/auth/` prefix — those paths return the webui HTML, not
JSON.

#### Scenario: All five methods hit the real endpoints
- **WHEN** the adapter source is grep'd for `/api/v1/auth/`
- **THEN** zero matches remain in `lib/fmd-auth.ts`

#### Scenario: All five methods use POST
- **WHEN** the adapter source is grep'd for `httpClient.get(` inside
  `lib/fmd-auth.ts`
- **THEN** zero matches remain (all auth calls are POST)

### Requirement: Errors surface to the user via the live Admin-UI Status panel
When any step of the auth flow throws, the adapter SHALL set
`info.connection` to `error` and `info.lastError` to the thrown
message. The Admin-UI's Connection Status panel SHALL display both
values within one polling cycle (≤ 5 s). The user SHALL NOT need to
read container logs to diagnose an auth failure.

#### Scenario: Auth error reaches the Status panel
- **WHEN** the user enters wrong credentials and saves
- **THEN** within 5 s the Connection Status panel shows
  `Status: error` and the underlying error message in the
  `Last Error` field
- **AND** no JavaScript exception is visible in the browser console

### Requirement: The auth flow is idempotent across adapter restarts
Restarting the adapter SHALL re-run the full auth flow from
`getSalt()`. The adapter SHALL NOT cache tokens across restarts.
Caching within one session is fine, but a process restart always
starts at `getSalt()`.

#### Scenario: Restart clears the in-memory token cache
- **WHEN** the adapter is restarted (e.g. via `iobroker restart
  iobroker-fmd.0`)
- **THEN** the new process calls `getSalt()` and runs the full auth
  flow again
- **AND** the previous process's cached `AuthTokens` is not reused

### Requirement: Auth library does not log secrets
The `FmdAuth` module SHALL log the salt (length + first 4 bytes hex),
the PHC string (length only), the access token (length only), and the
private key (length only). It SHALL NOT log the password, the full
salt, the full PHC string, the full access token, or the full
private key at any log level.

#### Scenario: Grep auth-related logs for the password
- **WHEN** an authentication run completes (success or failure)
- **THEN** a grep of the adapter logs for the configured password
  returns no match
- **AND** a grep for the first 8 characters of the access token
  returns no match
