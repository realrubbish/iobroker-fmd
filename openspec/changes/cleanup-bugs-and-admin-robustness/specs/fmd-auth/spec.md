# Capability: fmd-auth (delta)

## ADDED Requirements

### Requirement: Adapter call sites check hasValidTokens before re-authenticating
The four call sites in `src/main.ts` that call
`this.fmdAuth.authenticate()` SHALL first call
`this.fmdAuth.hasValidTokens()` and reuse the cached tokens
when the check returns `true`.

The four call sites are:
- `connectAndFetchDevices()` — the initial-connect path.
  The short-circuit only matters on a reconnect during the
  same adapter lifetime; on a fresh process the in-memory
  cache is empty and a full auth always runs.
- `fetchDevices()` — the device-list refresh path.
- `onMessage.testConnection` — the user-initiated test path.
- `onMessage.sendRingCommand` — the admin-UI ring-trigger
  path.

The pattern at each call site SHALL be:

```ts
if (this.fmdAuth.hasValidTokens()) {
    this.authTokens = this.fmdAuth.getTokens()!;
} else {
    this.authTokens = await this.fmdAuth.authenticate();
}
```

A full `authenticate()` call SHALL always re-cache the
returned tokens in `FmdAuth.cachedTokens` with a fresh
`expiresAt`. The 1-hour `expiresAt` set in
`FmdAuth.authenticate()` is the only expiry signal the
short-circuit consults.

#### Scenario: fetchDevices reuses cached tokens
- **WHEN** the adapter has cached tokens whose `expiresAt`
  is in the future
- **AND** a code path calls `fetchDevices()`
- **THEN** `fetchDevices()` does NOT call
  `FmdAuth.authenticate()`
- **AND** the HTTP requests to the FMD server for salt,
  access token, and private key are NOT issued
- **AND** the device list is fetched with the cached
  `accessToken` and `privateKey`

#### Scenario: sendRingCommand reuses cached tokens
- **WHEN** the adapter has cached tokens whose `expiresAt`
  is in the future
- **AND** the admin UI sends a `ring` message
- **THEN** the `sendRingCommand` handler does NOT call
  `FmdAuth.authenticate()`
- **AND** the ring is signed and POSTed with the cached
  `accessToken` and `privateKey`
- **AND** no Argon2id derivation runs

#### Scenario: testConnection reuses cached tokens
- **WHEN** the adapter has cached tokens whose `expiresAt`
  is in the future
- **AND** the user clicks `Test Connection` in the admin UI
- **THEN** `onMessage.testConnection` does NOT call
  `FmdAuth.authenticate()` for the "verify cached tokens
  still work" path
- **AND** the test completes within the existing
  Test-Connection client-side timeout (see
  `admin-ui` capability)

#### Scenario: Expired tokens force a fresh auth
- **WHEN** `cachedTokens.expiresAt` is in the past
- **AND** any of the four call sites runs
- **THEN** `hasValidTokens()` returns `false`
- **AND** the call site calls `FmdAuth.authenticate()` for
  a fresh salt + Argon2id + access + private-key flow
- **AND** the new tokens are cached with a fresh
  `expiresAt`

#### Scenario: First call after adapter start always re-authenticates
- **WHEN** the adapter process has just started
- **AND** no call to `FmdAuth.authenticate()` has succeeded
  yet
- **THEN** `hasValidTokens()` returns `false` (because
  `cachedTokens` is undefined)
- **AND** the first call to any of the four call sites
  runs the full auth flow
