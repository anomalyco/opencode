# Athena Agent

An AI-powered coding agent with a CLI interface and open API architecture.

## Overview

Athena Agent is a standalone AI coding agent extracted and rebranded from the OpenCode project. It provides:

- **Multi-agent system** with build, plan, general, and explore agents
- **25+ LLM provider support** via Vercel AI SDK (Anthropic, OpenAI, Google, Azure, AWS Bedrock, Groq, Mistral, and more)
- **Extensive tool ecosystem** - file operations, code search, shell execution, web access
- **Open REST API** - fully accessible HTTP endpoints for third-party integration
- **Terminal UI (TUI)** - rich interactive terminal interface
- **Plugin & Skill system** - extensible via plugins and MCP servers
- **SQLite persistence** - conversation history and session management

## Quick Start

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Show help
bun run dev -- --help

# Start the API server (headless mode)
bun run dev -- serve

# Run with a message
bun run dev -- run -m "Hello, Athena!"
```

## CLI Commands

```
athena run          Run agent with a message
athena serve        Start headless API server
athena models       List available models
athena providers    Manage AI providers
athena session      Manage sessions
athena mcp          Model Context Protocol servers
athena agent        Agent management
athena debug        Debug tools
athena upgrade      Upgrade to latest version
```

## API Endpoints

When running `athena serve`, the following REST API endpoints are available:

### Session Management
- `GET /session` - List all sessions
- `POST /session` - Create new session
- `GET /session/:id` - Get session details
- `GET /session/:id/message` - Get messages
- `POST /session/:id/message` - Send message (streaming)

### Agent & Tools
- `GET /agent` - List available agents
- `GET /skill` - List available skills
- `GET /command` - List commands

### Configuration
- `GET /config` - Get configuration
- `PUT /config` - Update configuration
- `GET /provider` - List providers

### System
- `GET /doc` - OpenAPI specification
- `GET /global/health` - Health check

## Environment Variables

All environment variables use the `ATHENA_` prefix:

- `ATHENA_CONFIG` - Path to config file
- `ATHENA_CONFIG_DIR` - Config directory override
- `ATHENA_SERVER_PASSWORD` - API server password
- `ATHENA_SERVER_USERNAME` - API server username
- `ATHENA_DB` - Database path override
- `ATHENA_PURE` - Run without external plugins

## Configuration

Create `athena.jsonc` in your project root or `~/.config/athena/athena.jsonc` for global config:

```jsonc
{
  // Provider configuration
  "provider": {
    "anthropic": {
      "apiKey": "sk-..."
    }
  },
  // Agent customization
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-20250514"
    }
  }
}
```

## Architecture

```
src/
├── agent/        # Agent definitions and service
├── provider/     # LLM provider integrations (25+)
├── session/      # Message processing and conversation loop
├── tool/         # Tool registry and built-in tools
├── server/       # HTTP API endpoints (Hono-based)
├── permission/   # Permission system
├── skill/        # Skill discovery
├── config/       # Configuration management
├── cli/          # CLI commands and TUI
├── storage/      # SQLite persistence (Drizzle ORM)
├── mcp/          # Model Context Protocol
├── plugin/       # Plugin system
└── util/         # Utilities
```

## License

MIT
