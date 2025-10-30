---
name: mcp-user
mode: command
description: Add a remote MCP server to your configuration
agent: build
subtask: true
version: 1.0.0
last_updated: 2025-10-20
command_schema_version: 1.0
inputs:
  - name: server_arguments
    type: string
    required: false
    description: Arguments for the remote MCP server (name, URL, auth, etc.)
cache_strategy:
  type: agent_specific
  ttl: 300
  invalidation: manual
  scope: command
success_signals:
  - "Remote MCP server added successfully"
  - "Configuration updated"
  - "Server connection validated"
failure_modes:
  - "Invalid server URL or credentials"
  - "Network connectivity issues"
  - "Configuration file permissions error"
---

# Add Remote MCP Server

This command adds a remote MCP (Model Context Protocol) server to your configuration, enabling access to external tools and services.

## Purpose

Add remote MCP servers to extend your development environment with external capabilities, APIs, and services.

## Usage

```bash
/mcp-user <server-name> <server-url> [auth-token]
```

## Examples

```bash
# Add a GitHub MCP server
/mcp-user github https://api.github.com/mcp your-auth-token

# Add a database MCP server
/mcp-user postgres https://db.example.com:5432/mcp

# Add a file system MCP server
/mcp-user filesystem https://storage.example.com/mcp
```

## Arguments

- **server-name**: Unique identifier for the MCP server
- **server-url**: URL endpoint for the remote MCP server
- **auth-token**: Optional authentication token or API key

## Process

1. **Validate Arguments**: Check server name uniqueness and URL format
2. **Test Connection**: Verify connectivity to the remote server
3. **Update Configuration**: Add server to MCP configuration file
4. **Validate Setup**: Test server functionality and capabilities

## Error Handling

### Invalid Server URL

- Expected: Valid HTTP/HTTPS URL
- Mitigation: Check URL format and server availability
- Requires user input: true

### Authentication Failure

- Expected: Valid credentials or token
- Mitigation: Verify auth token and permissions
- Requires user input: true

### Network Issues

- Expected: Successful network connection
- Mitigation: Check network connectivity and firewall settings
- Requires user input: false

## Success Criteria

- [ ] Server URL is valid and reachable
- [ ] Authentication credentials work correctly
- [ ] Server capabilities are discovered and cached
- [ ] Configuration file updated successfully
- [ ] Server appears in MCP server list

!`opencode mcp add user $ARGUMENTS`
