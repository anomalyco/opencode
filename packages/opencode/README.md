# OpenCode

> AI-powered coding assistant for the terminal. Supports 20+ LLM providers with MCP integration.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.1.51-blue.svg)]()

## Features

- **Multi-Provider Support**: Anthropic, OpenAI, Google, GitHub Copilot, Bedrock, Azure, xAI, Groq, Mistral, and 15+ more
- **Terminal UI**: Rich terminal interface built with SolidJS + OpenTUI
- **Web UI**: Server mode with REST API and real-time WebSocket updates
- **MCP Integration**: Connect to any Model Context Protocol server for extended capabilities
- **ACP Support**: Agent Client Protocol for agent-to-agent communication
- **Built-in Tools**: File operations, code search, bash execution, web fetch, LSP integration
- **Session Management**: Save, resume, and fork conversation sessions
- **Snapshots & Worktrees**: Git-based snapshot and worktree management
- **Skills System**: Extensible skill system for specialized workflows
- **Code Intelligence**: Tree-sitter parsing, ripgrep search, LSP hover/diagnostics

## Quick Start

### Installation

```bash
# Using Bun (recommended)
bun install -g opencode

# Using npm
npm install -g opencode

# Using Docker
docker run -it ghcr.io/opencode-ai/opencode
```

### Usage

```bash
# Start interactive TUI
opencode

# Start with a specific provider
opencode --provider anthropic

# Server mode (Web UI)
opencode serve --port 8080

# Run a one-shot command
opencode run "fix the failing tests"

# Export session
opencode export <session-id>
```

## Configuration

OpenCode looks for configuration in:
1. `~/.config/opencode/config.json` (global)
2. `.opencode/config.json` (project-local)

### Provider Setup

```json
{
  "provider": {
    "default": "anthropic",
    "anthropic": {
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

Set your API key:
```bash
opencode auth login anthropic
# or
export ANTHROPIC_API_KEY=sk-...
```

## Architecture

```
src/
├── acp/           # Agent Client Protocol
├── agent/         # AI agent loop
├── auth/          # API key management
├── cli/           # CLI commands & TUI
│   └── cmd/tui/   # SolidJS + OpenTUI terminal interface
├── config/        # Configuration management
├── file/          # File operations & ripgrep integration
├── lsp/           # Language Server Protocol client
├── mcp/           # Model Context Protocol integration
├── permission/    # Permission system
├── plugin/        # Plugin system
├── provider/      # 20+ LLM provider adapters
├── server/        # Hono HTTP/WebSocket server
├── session/       # Session & conversation management
├── skill/         # Skills system
├── snapshot/      # Git snapshot management
├── tool/          # Built-in tools (bash, read, write, etc.)
├── worktree/      # Git worktree management
└── util/          # Shared utilities
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Type check
bun run typecheck

# Run tests
bun test

# Build
bun run build
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed development guide.

## MCP Server Integration

Connect external tools via MCP:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
      }
    }
  }
}
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `read` | Read file contents |
| `write` | Write/create files |
| `edit` | Edit existing files |
| `multiedit` | Edit multiple files at once |
| `grep` | Search file contents (ripgrep) |
| `glob` | Find files by pattern |
| `ls` | List directory contents |
| `codesearch` | Tree-sitter code search |
| `webfetch` | Fetch web content |
| `websearch` | Search the web |
| `task` | Spawn sub-agent tasks |
| `batch` | Run multiple tool calls in parallel |
| `plan` | Create and manage plans |
| `lsp` | Language Server Protocol queries |
| `todo` | Manage task lists |
| `question` | Ask the user a question |
| `skill` | Invoke registered skills |

## CLI Commands

| Command | Description |
|---------|-------------|
| `opencode` | Start the interactive TUI |
| `opencode run` | Execute a one-shot prompt |
| `opencode serve` | Start the HTTP/WebSocket server |
| `opencode web` | Open web UI |
| `opencode auth` | Manage API key authentication |
| `opencode models` | List available models |
| `opencode session` | Manage sessions |
| `opencode export` | Export session data |
| `opencode import` | Import session data |
| `opencode mcp` | Manage MCP servers |
| `opencode acp` | Agent Client Protocol commands |
| `opencode pr` | GitHub PR operations |
| `opencode stats` | Usage statistics |
| `opencode upgrade` | Upgrade OpenCode |
| `opencode uninstall` | Uninstall OpenCode |

## Security

OpenCode enforces path sandboxing to prevent tools from accessing files outside the project directory. All tool operations go through permission checks that require user approval for potentially destructive actions.

For security concerns, please open an issue with the `security` label.

## Contributing

Contributions are welcome! Please see the [Development Guide](docs/DEVELOPMENT.md) for code style, testing requirements, and architecture details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Write tests for your changes
4. Ensure `bun test` and `bun run typecheck` pass
5. Submit a pull request

## License

MIT
