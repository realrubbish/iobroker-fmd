## Context

The ioBroker-fmd-adapter development requires a running ioBroker instance to test ring notifications and FMD server communication. Currently, developers must install and configure ioBroker natively, which is time-consuming and error-prone.

MQTT is only needed for the Shelly→ioBroker input path. For adapter development, ioBroker's native state simulation (via admin UI or direct state setting) is sufficient.

This design establishes a Docker-based local development environment that can be started with a single command.

## Goals / Non-Goals

**Goals:**
- One-command local development environment setup via Docker Compose
- Mount source code for hot reload of the adapter
- Self-contained: no external services required beyond Docker Desktop

**Non-Goals:**
- Production deployment (use ioBroker's native installation for production)
- Full CI/CD pipeline (see separate change if needed)
- Windows/Linux parity testing (macOS-focused for now)

## Decisions

### Docker Compose as orchestration layer

**Decision**: Use Docker Compose for local orchestration.

**Rationale**: Simpler than Kubernetes (Docker Desktop's embedded K8s), sufficient for single-host development, widely understood.

**Alternatives**:
- Docker Compose vs. native K8s: K8s adds complexity without benefit for local dev
- Podman Compose: Less common in the target audience

### ioBroker Docker Image

**Decision**: Use `iobroker/iobroker:latest` as base image.

**Rationale**: Official image, maintained by ioBroker team, includes Node.js runtime.

**Alternatives**:
- Custom Dockerfile: More control but more maintenance burden
- ioBroker container via ioBroker Docker repository: Same as official

### Development Override

**Decision**: Provide `docker-compose.dev.yml` override file.

**Rationale**: Separates production-like base config from development-specific mounts and ports. Developers can use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Docker Desktop resource usage | Document minimum requirements (4GB RAM) |
| ioBroker image version mismatches | Pin image version in docker-compose.yml |
| Port conflicts (8081 ioBroker admin) | Use environment variables for port configuration |

## Open Questions

- Should we include a mock FMD server, or use the existing `fmd.example.com`?
- What ioBroker adapter versions should be pre-installed in the container?
