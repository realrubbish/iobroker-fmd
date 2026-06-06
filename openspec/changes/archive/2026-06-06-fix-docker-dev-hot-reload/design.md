## Context

The Docker-based development environment uses docker compose with override file (`docker-compose.dev.yml`) to mount the local adapter source code into the ioBroker container for hot-reload development. However, the current configuration has hardcoded paths and missing environment variables that make it fragile across different developer environments.

Current issues:
1. The volume mount in `docker-compose.dev.yml` uses a hardcoded absolute path `/Users/tschnurre/external-GIT/ioBroker-fmd-adapter`
2. The `.env.example` doesn't include variables for the volume source path, making it non-obvious how to customize
3. The README workflow commands show inconsistent docker compose syntax

## Goals / Non-Goals

**Goals:**
- Make the Docker development workflow configurable via environment variables
- Ensure the hot-reload volume mount works reliably across different host paths
- Update documentation to accurately reflect the actual docker compose commands
- Add troubleshooting guidance for common Docker development issues

**Non-Goals:**
- Restructuring the base `docker-compose.yml` (only modifying `docker-compose.dev.yml`)
- Changing the adapter source code or build process
- Adding new Docker services or complex orchestration

## Decisions

### 1. Environment Variables for Volume Source Path

**Decision:** Add `FMD_ADAPTER_SOURCE` variable to `.env.example` that defaults to `.` (current directory relative to the compose file).

**Rationale:** Developers may clone the repo to different locations. Making this configurable allows each developer to set their local path once and have it apply consistently.

**Limitation discovered:** `${PWD}` does NOT work in `.env` files. Docker compose reads `.env` as literal values — it does not perform shell variable expansion. `${PWD}` resolves to empty string because there is no env var `PWD` visible to docker compose.

**Alternatives considered:**
- Use `${PWD}`: Does not work — shell variables are not available to docker compose `.env` parsing
- Use absolute path: Fragile — hardcoded paths don't work across developer machines
- Use relative path (`.`): Works correctly — docker compose resolves relative paths from the compose file location, not the invoking shell's cwd. This is the correct default since the compose file sits in the project root.

### 2. Keep Volume Mount in Override File

**Decision:** Keep the volume mount in `docker-compose.dev.yml` as an override, not the base config.

**Rationale:** The base `docker-compose.yml` is the production-ready configuration. Development-only mounts belong in the dev override to maintain a clean production reference.

**Alternatives considered:**
- Merge into base config with conditional mounts: Adds complexity to the base YAML structure
- Separate dev-specific compose file without override pattern: Loses the ability to cleanly toggle dev mode on/off

### 3. README Documentation Alignment

**Decision:** Update README to show the exact commands as they are currently used in the project.

**Rationale:** The README is the first point of contact for developers. If the documented commands don't match what's actually needed, it erodes trust in the documentation.

## Risks / Trade-offs

- **Risk:** Hardcoded paths in version control could drift from developer environments
  - **Mitigation:** Document the need to set `FMD_ADAPTER_SOURCE` in `.env` if the default doesn't match

- **Risk:** Docker volume mounts on macOS can have file watching limitations
  - **Mitigation:** Document the potential need for polling-based file watching if native events don't work

- **Trade-off:** More environment variables vs. simplicity
  - **Mitigation:** Only add variables that are genuinely needed for customization; defaults should work for the standard workflow
