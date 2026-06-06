## Context

The MCP (Model Context Protocol) server for ioBroker currently connects to the production server at `https://zephyr.example.com:8087`. For local development with the docker dev container (`iobroker-fmd-dev`), we need to reconfigure the MCP to connect to the local docker instance running on port 8081.

The docker dev setup uses `docker-compose.dev.yml` which mounts the adapter source for hot reload. The MCP server needs network access to the container.

## Goals / Non-Goals

**Goals:**
- Configure MCP to connect to local docker dev ioBroker container
- Ensure hot-reload adapter changes can be tested via MCP tools
- Maintain ability to switch back to production configuration

**Non-Goals:**
- Changing the production MCP configuration (production uses different credentials/host)
- Setting up authentication for the docker dev instance

## Decisions

### 1. Use localhost with docker port mapping

**Decision:** Connect MCP to `http://localhost:8081` (mapped from docker container port 8081)

**Rationale:** The `docker-compose.yml` already exposes port 8081 to the host. Using localhost is the simplest approach.

**Alternative:** Could create a custom docker network and connect via container name, but this requires extra MCP configuration and doesn't work well with the simple API server.

### 2. Use query-based authentication for simplicity

**Decision:** Use `--authType=query` with admin credentials

**Rationale:** The `iobroker-simple-api-mcp-server` supports query-based auth which works well for local development. Credentials can be found in the docker container logs or `.env` file.

**Alternative:** Set up token-based auth - adds complexity without benefit for local dev.

## Risks / Trade-offs

- **Risk:** Exposed credentials in `.mcp.json` are for local dev only
  - **Mitigation:** Use development credentials only, never commit production credentials

- **Risk:** Port 8081 may conflict with local ioBroker installation
  - **Mitigation:** `IOBROKER_PORT` env var can change the mapped port; MCP config would need corresponding update
