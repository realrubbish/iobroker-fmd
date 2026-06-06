## ADDED Requirements

### Requirement: Docker Compose base configuration
The system SHALL provide a `docker-compose.yml` file that defines an ioBroker service.

#### Scenario: Base docker-compose defines ioBroker service
- **WHEN** developer runs `docker compose up`
- **THEN** ioBroker container is created with default configuration

### Requirement: Development override configuration
The system SHALL provide a `docker-compose.dev.yml` override file for development with source code mounting.

#### Scenario: Dev override mounts source code
- **WHEN** developer runs `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
- **THEN** the adapter source code is mounted into the ioBroker container at `/opt/iobroker/node_modules/iobroker.fmd`

#### Scenario: Dev override exposes admin interface
- **WHEN** dev override is active
- **THEN** ioBroker admin interface is accessible on port 8081

### Requirement: Self-contained environment
The system SHALL operate without external network dependencies beyond Docker Desktop.

#### Scenario: All services start locally
- **WHEN** developer runs `docker compose up` on a machine with Docker Desktop
- **THEN** ioBroker starts successfully without requiring internet connectivity for the services themselves

### Requirement: Port configuration flexibility
The system SHALL allow customization of exposed ports via environment variables.

#### Scenario: Custom port via env file
- **WHEN** developer creates `.env` file with `IOBROKER_PORT=9081`
- **THEN** ioBroker admin interface is accessible on port 9081 instead of default 8081
