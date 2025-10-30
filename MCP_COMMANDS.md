# MCP Management Commands

This document describes the new MCP (Model Context Protocol) server management commands implemented in OpenCode.

## Overview

OpenCode now supports easy addition of MCP servers through both CLI commands and slash commands. MCP servers allow you to extend OpenCode's capabilities with external tools and services.

## CLI Commands

### Add Remote MCP Server

```bash
opencode mcp add user <name> <url> [options]
```

**Options:**

- `--headers, -H`: Headers in format 'Key: Value' (array)
- `--enabled`: Enable server on startup (default: true)

**Example:**

```bash
opencode mcp add user github https://api.github.com/mcp --headers "Authorization: Bearer token"
```

### Add Local MCP Server

```bash
opencode mcp add local <name> <command..> [options]
```

**Options:**

- `--env, -e`: Environment variables in format 'KEY=VALUE' (array)
- `--enabled`: Enable server on startup (default: true)

**Example:**

```bash
opencode mcp add local filesystem "npx @modelcontextprotocol/server-filesystem /path/to/files"
```

### Interactive MCP Server Addition

```bash
opencode mcp add
```

Launches an interactive wizard to guide you through adding either a local or remote MCP server.

## Slash Commands

Slash commands can be used directly in the OpenCode TUI for quick MCP server management.

### `/mcp-user`

Add a remote MCP server.

**Usage:**

```
/mcp-user <server-name> <server-url> [auth-token]
```

**Examples:**

```
# Add a GitHub MCP server
/mcp-user github https://api.github.com/mcp your-auth-token

# Add a database MCP server
/mcp-user postgres https://db.example.com:5432/mcp

# Add a file system MCP server
/mcp-user filesystem https://storage.example.com/mcp
```

### `/mcp-local`

Add a local MCP server.

**Usage:**

```
/mcp-local <server-name> <server-command> [working-directory]
```

**Examples:**

```
# Add a filesystem server
/mcp-local filesystem "npx @modelcontextprotocol/server-filesystem /Users/john/projects"

# Add a Git server
/mcp-local git "npx @modelcontextprotocol/server-git /Users/john/projects"

# Add a SQLite server
/mcp-local database "npx @modelcontextprotocol/server-sqlite /path/to/database.db"
```

### `/mcp-add`

Interactive MCP server addition with guided setup.

**Usage:**

```
/mcp-add [server-type]
```

Launches a step-by-step wizard for adding MCP servers with validation and testing.

## Configuration

MCP servers are stored in your `opencode.jsonc` configuration file under the `mcp` section:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "github": {
      "type": "remote",
      "url": "https://api.github.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      },
      "enabled": true
    },
    "filesystem": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-filesystem", "/path/to/files"],
      "enabled": true
    }
  }
}
```

## Server Types

### Remote Servers

Remote MCP servers connect to external services via HTTP/HTTPS. They support:

- Custom headers for authentication
- URL validation and connectivity testing
- Optional authentication tokens

### Local Servers

Local MCP servers run commands on your local machine. They support:

- Custom environment variables
- Command validation
- Working directory specification

## Features

### Validation

- **URL Validation**: Remote servers validate URL format before adding
- **Connectivity Testing**: Remote servers test connection before saving
- **Command Validation**: Local servers verify command syntax

### Error Handling

- **Graceful Failure**: Servers with connection issues can still be added with user confirmation
- **Clear Error Messages**: Detailed error messages help troubleshoot issues
- **Rollback Support**: Failed configurations don't corrupt existing setup

### Configuration Management

- **Atomic Updates**: Configuration files are updated atomically
- **Backup Support**: Existing configurations are preserved
- **Schema Validation**: All configurations validate against the OpenCode schema

## Common Use Cases

### Development Tools

```bash
# Add local filesystem access
/mcp-local filesystem "npx @modelcontextprotocol/server-filesystem ~/projects"

# Add Git integration
/mcp-local git "npx @modelcontextprotocol/server-git ~/projects"
```

### External Services

```bash
# Add GitHub integration
/mcp-user github https://api.github.com/mcp $GITHUB_TOKEN

# Add database access
/mcp-user database https://db.example.com:5432/mcp
```

### AI Services

```bash
# Add Context7 for documentation search
/mcp-user context7 https://mcp.context7.com/mcp

# Add Grep by Vercel for code search
/mcp-user grep https://mcp.grep.app
```

## Troubleshooting

### Connection Issues

If a remote server fails to connect:

1. Verify the URL is correct and accessible
2. Check network connectivity and firewall settings
3. Validate authentication tokens/headers
4. Try adding with `--enabled false` to configure manually

### Command Issues

If a local server fails to start:

1. Verify the command syntax and dependencies
2. Check that required tools are installed
3. Validate environment variables
4. Test the command manually in your terminal

### Configuration Issues

If configuration updates fail:

1. Check file permissions on `opencode.jsonc`
2. Ensure the configuration file is valid JSON
3. Verify disk space is available
4. Check for syntax errors in existing configuration

## Migration from Previous Versions

If you have existing MCP server configurations, they will be automatically migrated to the new format. No manual intervention is required.

## Security Considerations

- **Authentication Tokens**: Store tokens securely using environment variables
- **Network Access**: Remote servers have network access to their specified URLs
- **Local Commands**: Local servers can execute commands on your machine
- **Permissions**: Review server permissions before adding

## Support

For issues with MCP management commands:

1. Check the OpenCode documentation at https://opencode.ai/docs/mcp-servers
2. Review the troubleshooting section above
3. Open an issue on the OpenCode GitHub repository
4. Join the OpenCode Discord community for support
