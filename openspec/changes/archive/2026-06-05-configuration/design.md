## Context

The ioBroker FMD adapter needs to connect to an external FMD server to ring devices. The FMD server uses a multi-step authentication flow that is more complex than simple username/password authentication. The adapter settings must provide a way to configure the server endpoint and credentials while storing them securely.

Current state: No FMD server configuration exists in the adapter.

Constraints:
- Must use `encryptedNative` for secure password storage per ioBroker conventions
- Must implement the FMD authentication flow as documented at https://fmd-foss.org/docs/fmd-server
- Adapter settings are defined in `io-package.json` using JSON Schema

## Goals / Non-Goals

**Goals:**
- Provide adapter settings UI for FMD server endpoint and credentials
- Implement secure credential storage using ioBroker's `encryptedNative` mechanism
- Implement full FMD authentication flow (Salt → Argon2id → Access Token → Private Key)
- Show connection status in adapter settings
- Validate configuration before attempting connection

**Non-Goals:**
- Not implementing device management (only ring trigger functionality)
- Not implementing user account creation/management (only authentication to existing accounts)
- Not implementing MQTT broker configuration (handled separately)

## Decisions

### Decision: Use `encryptedNative` for credential encryption
**Chosen:** Use `encryptedNative: ["native.password"]` in `io-package.json` schema

**Rationale:** ioBroker provides built-in encryption for credentials marked with `encryptedNative`. This avoids implementing custom encryption and integrates with ioBroker's existing security infrastructure.

**Alternatives considered:**
- Custom encryption: Would require additional code and potential security review
- Plain storage: Not acceptable for production - credentials would be visible in config files

### Decision: Authentication module as separate TypeScript class
**Chosen:** Create `src/lib/fmd-auth.ts` for authentication logic

**Rationale:** Separating authentication into its own module:
- Single responsibility: adapter main.ts doesn't handle auth logic
- Testable: Can unit test auth flow independently
- Reusable: If ring logic needs re-auth, the module can be reused

**Alternatives considered:**
- Inline in adapter class: Would couple auth to adapter lifecycle, harder to test
- Separate npm package: Overkill for this adapter's needs

### Decision: Lazy authentication (on first API call, not on adapter start)
**Chosen:** Authenticate on first API call that requires it

**Rationale:**
- Adapter starts faster without waiting for FMD server
- If FMD server is down, adapter still starts (just ring operations fail)
- Tokens cached in memory, refreshed as needed

**Alternatives considered:**
- Eager authentication on start: Would delay adapter startup, fail if server unreachable
- Periodic keepalive: Unnecessary complexity, tokens are long-lived

### Decision: Store private key for token refresh
**Chosen:** Store the private key in memory after initial authentication

**Rationale:** FMD uses short-lived access tokens that expire. Having the private key allows silent refresh without requiring user re-entry of password.

**Alternatives considered:**
- Re-authenticate with password on expiry: Requires password to be stored decrypted or re-entered
- Short-lived tokens only: Would break ring functionality mid-session

## Risks / Trade-offs

[Risk] Argon2id computation is CPU-intensive
→ **Mitigation:** Argon2id runs once per authentication (not per request). Cache tokens to minimize auth calls.

[Risk] If FMD server changes auth protocol, adapter breaks
→ **Mitigation:** Log auth failures clearly. Implement version detection if API provides it.

[Risk] Encrypted credentials visible in io-package.json backup files
→ **Mitigation:** Document that ioBroker backup files containing io-package.json should be handled carefully.

## Migration Plan

1. User updates adapter via ioBroker admin
2. New configuration fields appear in adapter settings (empty/default)
3. User enters FMD server URL, username, password
4. On save, adapter validates configuration
5. First ring operation triggers authentication flow
6. Connection status updates to reflect actual state

**Rollback:** Users can downgrade adapter; existing config remains in io-package.json but may be ignored by older code.

## Open Questions

- Should we support multiple FMD server configurations (dev/prod)?
- How should we handle connection retries (exponential backoff)?
- Do we need to expose authentication errors to vis-2 UI?
