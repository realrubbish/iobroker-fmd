## Why

The MCP server currently connects to the production ioBroker instance (`https://zephyr.example.com:8087`). During development, we need the MCP to connect to the local docker dev ioBroker container (`iobroker-fmd-dev`) to test adapter changes without affecting production.

## What Changes

- Configure `.mcp.json` to connect to the local docker dev ioBroker container instead of the production server
- Add network configuration to allow MCP to reach the docker container
- Document the connection parameters for local development

## Capabilities

### New Capabilities
- `docker-dev-mcp-connection`: Configure MCP server to use docker dev ioBroker container for local development with hot-reload adapter testing

### Modified Capabilities
<!-- No existing spec requirements are changing -->

## Impact

- `.mcp.json` - MCP server configuration file
- `docker-compose.dev.yml` - May need network configuration for MCP access
