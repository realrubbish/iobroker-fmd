## ADDED Requirements

### Requirement: A standalone dry-run script can exercise the auth flow
The repository SHALL ship `scripts/auth-smoke.mjs`, a Node ESM script that takes a server URL, username, and password (via environment variables `FMD_SERVER_URL`, `FMD_USERNAME`, `FMD_PASSWORD`) and runs the full `FmdAuth.authenticate()` flow against that server. On success the script SHALL print `OK access_token=<first 8 chars>... private_key=<first 8 chars>...` and exit with code 0. On failure the script SHALL print the thrown error message and exit with code 1.

#### Scenario: Run against a real FMD server with valid credentials
- **WHEN** the user runs `FMD_SERVER_URL=https://fmd.example.com FMD_USERNAME=alice FMD_PASSWORD=secret node scripts/auth-smoke.mjs` against a working FMD server
- **THEN** the script exits 0
- **AND** prints a single `OK` line containing the truncated token + key

#### Scenario: Run with wrong password
- **WHEN** the password is wrong
- **THEN** the script exits 1
- **AND** prints the FMD server's login-rejection message

#### Scenario: Run with no environment variables set
- **WHEN** `FMD_SERVER_URL`, `FMD_USERNAME`, or `FMD_PASSWORD` is missing
- **THEN** the script exits 2
- **AND** prints which variable is missing

### Requirement: The dry-run script does not require the ioBroker runtime
`scripts/auth-smoke.mjs` SHALL depend only on the runtime dependencies of the adapter (`axios`, the new `argon2` or `hash-wasm` package, and the `src/lib/fmd-auth.ts` module compiled to `build/lib/fmd-auth.js`). It SHALL NOT depend on `@iobroker/adapter-core`, the `iobroker` CLI, or any controller-side packages. The script is invokable from a plain `node` shell on the dev host, not just from inside the Docker container.

#### Scenario: Run on a clean checkout of the repo
- **WHEN** a developer clones the repo, runs `npm install`, runs `npm run build`, then runs `node scripts/auth-smoke.mjs` with credentials set
- **THEN** the script works without Docker, without ioBroker, and without any controller-side state
