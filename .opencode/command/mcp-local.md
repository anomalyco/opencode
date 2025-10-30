---
name: mcp-local
mode: command
description: Add a local MCP server to your configuration
agent: build
subtask: true
version: 1.0.0
last_updated: 2025-10-20
command_schema_version: 1.0
inputs:
  - name: server_arguments
    type: string
    required: false
    description: Arguments for the local MCP server (name, command, path, etc.)
cache_strategy:
  type: agent_specific
  ttl: 300
  invalidation: manual
  scope: command
success_signals:
  - "Local MCP server added successfully"
  - "Configuration updated"
  - "Server process validated"
failure_modes:
  - "Invalid server command or path"
  - "Permission denied for server execution"
  - "Configuration file permissions error"
---

# Add Local MCP Server

This command adds a local MCP (Model Context Protocol) server to your configuration, enabling access to local tools and services running on your machine.

## Purpose

Add local MCP servers to integrate development tools, databases, file systems, and other local services with your AI development environment.

## Usage

```bash
/mcp-local <server-name> <server-command> [working-directory]
```

## Examples

```bash
# Add a local filesystem MCP server
/mcp-local filesystem "npx @modelcontextprotocol/server-filesystem /tmp"

# Add a local Git MCP server
/mcp-local git "npx @modelcontextprotocol/server-git --repository /path/to/repo"

# Add a local SQLite MCP server
/mcp-local sqlite "npx @modelcontextprotocol/server-sqlite --db-path ./data.db"

# Add a custom local MCP server
/mcp-local custom-server "node /path/to/server.js" /path/to/working/dir
```

## Arguments

- **server-name**: Unique identifier for the MCP server
- **server-command**: Command to start the local MCP server
- **working-directory**: Optional working directory for server execution

## Process

1. **Validate Command**: Check server command syntax and executable availability
2. **Test Execution**: Attempt to start the server process
3. **Discover Capabilities**: Query server for available tools and resources
4. **Update Configuration**: Add server to MCP configuration file
5. **Validate Setup**: Test server functionality and integration

## Error Handling

### Invalid Command

- Expected: Valid executable command or script
- Mitigation: Check command syntax and executable permissions
- Requires user input: true

### Server Start Failure

- Expected: Server starts successfully and responds to health checks
- Mitigation: Check server logs, dependencies, and configuration
- Requires user input: true

### Permission Issues

- Expected: Sufficient permissions to execute server command
- Mitigation: Check file permissions and user access rights
- Requires user input: true

## Success Criteria

- [ ] Server command is valid and executable
- [ ] Server starts successfully and responds to health checks
- [ ] Server capabilities are discovered and cached
- [ ] Configuration file updated successfully
- [ ] Server appears in MCP server list
- [ ] Server can be accessed through MCP protocol

## Common Local MCP Servers

### File System Access

```bash
/mcp-local filesystem "npx @modelcontextprotocol/server-filesystem /path/to/directory"
```

### Git Repository Access

```bash
/mcp-local git "npx @modelcontextprotocol/server-git --repository /path/to/repo"
```

### Database Access

```bash
/mcp-local postgres "npx @modelcontextprotocol/server-postgres --connection-string postgresql://user:pass@localhost/db"
```

### Development Tools

```bash
/mcp-local docker "npx @modelcontextprotocol/server-docker"
/mcp-local kubernetes "npx @modelcontextprotocol/server-kubernetes"
```

!`opencode mcp add local $ARGUMENTS`
