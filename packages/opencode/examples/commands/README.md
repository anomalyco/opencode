# MCP Management Commands

This directory contains example slash commands for easily adding MCP (Model Context Protocol) servers to OpenCode.

## Available Commands

### `/mcp-user` - Add Remote MCP Server

Add a remote MCP server by URL and name.

**Usage:**

```
/mcp-user <name> <url> [options]
```

**Examples:**

```bash
# Basic remote server
/mcp-user context7 https://mcp.context7.com/mcp

# With authentication headers
/mcp-user my-server https://api.example.com/mcp --headers "Authorization: Bearer token123"

# Disable on startup
/mcp-user test-server https://test.example.com/mcp --enabled false
```

**Options:**

- `--headers, -H`: Headers in format "Key: Value" (can be used multiple times)
- `--enabled`: Enable server on startup (default: true)

### `/mcp-local` - Add Local MCP Server

Add a local MCP server that runs as a command.

**Usage:**

```
/mcp-local <name> <command...> [options]
```

**Examples:**

```bash
# Filesystem server
/mcp-local filesystem npx -y @modelcontextprotocol/server-filesystem /tmp

# Custom local server with environment variables
/mcp-local my-server node /path/to/server.js --env "API_KEY=secret123" --env "DEBUG=true"

# Multiple command arguments
/mcp-local custom-server bun run /path/to/mcp-server.ts --port 3000
```

**Options:**

- `--env, -e`: Environment variables in format "KEY=VALUE" (can be used multiple times)
- `--enabled`: Enable server on startup (default: true)

## Installation

To use these commands in your OpenCode installation:

### Option 1: Copy to Global Commands

```bash
# Copy to global commands directory
mkdir -p ~/.config/opencode/command
cp examples/commands/mcp-*.md ~/.config/opencode/command/
```

### Option 2: Copy to Project Commands

```bash
# Copy to project-specific commands directory
mkdir -p .opencode/command
cp examples/commands/mcp-*.md .opencode/command/
```

### Option 3: Add to JSON Config

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "command": {
    "mcp-user": {
      "description": "Add a remote MCP server",
      "template": "Add a remote MCP server with the specified name and URL.\n\n!`opencode mcp user $ARGUMENTS`\n\nThe MCP server will be configured and available as tools once added.",
      "agent": "build",
      "subtask": true
    },
    "mcp-local": {
      "description": "Add a local MCP server",
      "template": "Add a local MCP server with the specified name and command.\n\n!`opencode mcp local $ARGUMENTS`\n\nThe MCP server will be configured and available as tools once added.",
      "agent": "build",
      "subtask": true
    }
  }
}
```

## CLI Equivalents

These slash commands are wrappers around the CLI commands:

```bash
# Equivalent CLI commands
opencode mcp user <name> <url> [options]
opencode mcp local <name> <command...> [options]

# Interactive add (original)
opencode mcp add
```

## MCP Server Examples

### Popular MCP Servers

**Context7** (Documentation search):

```bash
/mcp-user context7 https://mcp.context7.com/mcp
```

**Grep by Vercel** (Code search):

```bash
/mcp-user gh_grep https://mcp.grep.app
```

**Filesystem** (Local file access):

```bash
/mcp-local filesystem npx -y @modelcontextprotocol/server-filesystem /path/to/directory
```

**GitHub** (GitHub integration):

```bash
/mcp-local github npx -y @modelcontextprotocol/server-github
```

## Configuration

Once added, MCP servers appear as tools in your OpenCode sessions. You can:

- Use them by name: "Use the context7 tool to search documentation"
- Enable/disable them globally in your config
- Control access per agent using agent-specific tool permissions

For more information, see: https://opencode.ai/docs/mcp-servers
