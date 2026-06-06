## ADDED Requirements

### Requirement: Docker dev MCP connection

The MCP server SHALL be configurable to connect to the local docker dev ioBroker container for local development and testing.

#### Scenario: Connect MCP to docker dev container

- **WHEN** the user starts the docker dev ioBroker container
- **THEN** the MCP server SHALL connect to `http://localhost:8081` using the simple API server

#### Scenario: MCP tools work with docker dev instance

- **WHEN** MCP is connected to docker dev ioBroker
- **THEN** all MCP tools (getState, setState, getObjects, etc.) SHALL function against the local container

#### Scenario: Switch from production to dev

- **WHEN** the user updates `.mcp.json` with docker dev settings
- **THEN** Claude Code SHALL reconnect to the local ioBroker instance on next prompt
