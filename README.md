# Forge

**TUI for ACP agents with local server infrastructure**

Forge is a terminal-based interface for working with Agent Client Protocol (ACP) agents. It combines a powerful TUI built with Solid.js and OpenTUI, a local HTTP server for session management and authentication, and a robust ACP client for managing agent processes.

---

## Architecture

Forge consists of three main components:

### 1. **TUI (Terminal User Interface)**
- Built with Solid.js and OpenTUI
- Provides interactive terminal-based interface for agent interactions
- Located in `packages/forge/src/cli/cmd/tui/`

### 2. **HTTP Server**
- Hono-based HTTP API for session management
- Handles authentication and configuration
- Provides server infrastructure for future features
- Located in `packages/forge/src/server/`

### 3. **ACP Client**
- Manages ACP agent subprocesses
- Handles agent lifecycle and communication
- Implements the Agent Client Protocol
- Located in `packages/forge/src/acp/`

### 4. **MCP Integration**
- ACP agents use MCP (Model Context Protocol) servers for tool integration
- MCP provides tools and resources to agents
- Located in `packages/forge/src/mcp/`

---

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Or run directly
bun run --cwd packages/forge dev
```

---

## Project Structure

```
packages/
├── forge/              # Main TUI application
│   ├── src/
│   │   ├── acp/       # ACP client implementation
│   │   ├── cli/       # CLI commands including TUI
│   │   ├── mcp/       # MCP integration
│   │   └── server/    # HTTP server
├── sdk/                # TypeScript SDK (@forge/sdk)
├── util/               # Shared utilities (@forge/util)
├── script/             # Build tools (@forge/script)
└── opencode-archive/   # Archived packages from OpenCode
```

---

## Archived Packages

This repository was refactored from OpenCode. All non-essential packages have been moved to `packages/opencode-archive/` for future reference. This includes:

- Console/SaaS platform packages
- Desktop and web applications
- Plugin system
- Slack integration
- Other language SDKs (Go, Python)
- And more...

Nothing was deleted - everything is preserved in the archive.

---

## SDK Communication Flow

The SDK (`@forge/sdk`) provides the communication layer between:
1. The TUI client
2. The local HTTP server
3. ACP agent processes

This enables features like:
- Session management
- Configuration synchronization
- Multi-client support (future: drive from mobile app while running on desktop)

---

## Contributing

This is an experimental project focused on building a robust TUI for ACP agents. Contributions are welcome!

---

## License

MIT
