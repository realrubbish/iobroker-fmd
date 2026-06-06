## Why

The Docker-based development environment with hot-reload has configuration issues that make local development unreliable. The `.env.example` is missing critical variables needed for proper development workflow, and the README workflow documentation doesn't reflect the actual docker compose commands being used.

## What Changes

- Fix Docker hot-reload volume mount configuration for reliable development
- Extend `.env.example` with missing development variables (volumes, paths)
- Update README development section to accurately reflect docker compose workflow
- Add troubleshooting section for common Docker dev issues

## Capabilities

### New Capabilities

- `docker-dev-workflow`: Document and fix the Docker-based development workflow with proper volume mounts and environment configuration

### Modified Capabilities

- (none)

## Impact

- Files: `docker-compose.dev.yml`, `.env.example`, `README.md`
- Docker volume mounts for adapter development
- Developer experience for local development
