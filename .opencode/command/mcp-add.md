---
name: mcp-add
mode: command
description: Interactive MCP server addition with guided setup
agent: build
subtask: true
version: 1.0.0
last_updated: 2025-10-20
command_schema_version: 1.0
inputs:
  - name: server_type
    type: string
    required: false
    description: Type of MCP server to add (user/local)
  - name: server_config
    type: string
    required: false
    description: Server configuration details
cache_strategy:
  type: agent_specific
  ttl: 300
  invalidation: manual
  scope: command
success_signals:
  - "MCP server added interactively"
  - "Configuration completed successfully"
  - "Server validated and ready"
failure_modes:
  - "User cancelled interactive setup"
  - "Invalid server configuration provided"
  - "Server validation failed"
---

# Interactive MCP Server Addition

This command provides an interactive, guided experience for adding MCP servers to your configuration with step-by-step validation and setup.

## Purpose

Simplify the process of adding MCP servers by providing an interactive wizard that guides users through configuration, validation, and setup.

## Usage

```bash
/mcp-add [server-type]
```

## Examples

```bash
# Start interactive setup (will prompt for server type)
/mcp-add

# Start interactive setup for remote servers
/mcp-add user

# Start interactive setup for local servers
/mcp-add local
```

## Interactive Setup Process

### Step 1: Server Type Selection

- Choose between remote (user) or local server
- Get explanations of each type and use cases
- Select based on your requirements

### Step 2: Basic Configuration

- **Remote Servers**: Server name, URL, authentication method
- **Local Servers**: Server name, command, working directory
- Validation of input format and requirements

### Step 3: Advanced Configuration (Optional)

- Custom headers and parameters (remote)
- Environment variables (local)
- Timeout and retry settings
- Resource limits and permissions

### Step 4: Connection Testing

- Test server connectivity and responsiveness
- Validate authentication credentials
- Discover server capabilities
- Verify protocol compatibility

### Step 5: Configuration Review

- Review all settings before saving
- Test server functionality with sample requests
- Confirm configuration and save to file

## Guided Prompts

### Remote Server Setup

```
🔗 Setting up Remote MCP Server

1. Server Name: my-remote-server
2. Server URL: https://api.example.com/mcp
3. Authentication: [Bearer Token / API Key / None]
4. Headers: [Custom headers if needed]

Testing connection... ✅ Connected!
Discovering capabilities... ✅ Found 12 tools
Save configuration? [Y/n]
```

### Local Server Setup

```
🏠 Setting up Local MCP Server

1. Server Name: my-local-server
2. Command: npx @modelcontextprotocol/server-filesystem /tmp
3. Working Directory: /home/user/projects
4. Environment: [Custom env vars if needed]

Testing command... ✅ Server started!
Discovering capabilities... ✅ Found 8 tools
Save configuration? [Y/n]
```

## Error Handling

### Connection Failures

- Provides specific error messages and troubleshooting steps
- Suggests common fixes (URL format, auth tokens, network issues)
- Offers retry options with different configurations

### Validation Errors

- Real-time validation of input formats
- Clear error messages with correction suggestions
- Examples of correct input formats

### Permission Issues

- Detects permission problems early
- Provides guidance on fixing access rights
- Suggests alternative approaches

## Success Criteria

- [ ] User completes all required configuration steps
- [ ] Server connection test passes successfully
- [ ] Server capabilities are discovered and cached
- [ ] Configuration file updated with valid settings
- [ ] Server appears in MCP server list and is accessible
- [ ] User receives confirmation and next steps

## Advanced Features

### Configuration Templates

- Pre-configured templates for common MCP servers
- Quick setup for popular services (GitHub, filesystem, databases)
- Custom template creation and sharing

### Batch Operations

- Add multiple servers in one session
- Import server configurations from files
- Export configurations for backup or sharing

### Validation Modes

- **Quick**: Basic connectivity test
- **Comprehensive**: Full capability discovery and testing
- **Custom**: User-defined validation steps

!`opencode mcp add $ARGUMENTS`
