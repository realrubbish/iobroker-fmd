## Why

Developing and testing the ioBroker-fmd-adapter requires a running ioBroker instance. Setting this up manually is error-prone and not reproducible. Docker Desktop provides a containerized, self-contained local development environment that any developer can spin up with a single command.

## What Changes

- Add Docker Compose configuration for local ioBroker development
- Add docker-compose override for development (source code mounting, hot reload)
- Add README section documenting the Docker-based development workflow

## Capabilities

### New Capabilities

- `docker-dev-env`: Containerized local development environment with ioBroker for developing and testing the fmd-adapter

### Modified Capabilities

<!-- No existing capabilities being modified -->

## Impact

- New files: `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`
- Documentation: Development workflow section in README
- No changes to adapter source code or core functionality
