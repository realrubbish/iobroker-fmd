## ADDED Requirements

### Requirement: Docker development environment configuration

The Docker-based development environment SHALL provide a configurable setup that enables hot-reload development for the adapter.

#### Scenario: Start ioBroker with development overrides
- **WHEN** developer runs `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
- **THEN** ioBroker container starts with adapter source code mounted from the path specified in `.env`

#### Scenario: Hot-reload volume mount uses configured source path
- **WHEN** `FMD_ADAPTER_SOURCE` is set in `.env` file
- **THEN** the docker-compose.dev.yml mounts `${FMD_ADAPTER_SOURCE}:/opt/iobroker/node_modules/iobroker.fmd`
- **AND** changes to the host source directory are reflected inside the container

#### Scenario: Environment variables are documented
- **WHEN** developer copies `.env.example` to `.env`
- **THEN** all required variables for Docker development are present with descriptive comments
- **AND** default values work for the standard development workflow

### Requirement: README workflow documentation

The README SHALL accurately document the Docker development workflow with correct commands.

#### Scenario: Docker commands match actual project configuration
- **WHEN** developer follows README instructions to start development environment
- **THEN** the documented commands use the correct override file syntax (`-f docker-compose.yml -f docker-compose.dev.yml`)
- **AND** the port configuration refers to the correct `.env` variable (`IOBROKER_PORT`)

#### Scenario: Docker troubleshooting section exists
- **WHEN** developer encounters Docker-related issues
- **THEN** README includes a troubleshooting section with common problems and solutions
