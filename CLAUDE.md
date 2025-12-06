# Forge: Universal CLI for ACP Agents

**What we are:** A terminal-based interface that provides unified access to multiple AI coding agents through the Agent Client Protocol (ACP).

**What we are NOT:** We are not OpenCode. We forked from `sst/opencode` but have significantly diverged.

---

## Quick Start

**Package Manager:** Bun (required - `bun@1.3.3`)

**Development:**

```bash
bun install
bun run dev
```

**Testing:**

```bash
bun test                    # All tests
bun test test/acp/          # ACP-specific tests
```

**Type Checking:**

```bash
bun run typecheck
```

**View logs:**
Logs are located at `~/.local/share/forge/log/dev.log`

---

## Architecture Overview

Forge is a **Bun monorepo** with three core architectural layers:

### 1. TUI Layer (`packages/forge/src/cli/cmd/tui/`)

- **Framework:** Solid.js + OpenTUI (from `@opentui/core` and `@opentui/solid`)
- **Purpose:** Interactive terminal interface for agent interactions
- **Key Files:**
  - `app.tsx` - Main TUI application
  - `component/prompt/` - Prompt input and rendering
  - `context/` - Solid.js context providers (local state, theme)
  - `routes/session/` - Session-specific views

### 2. HTTP Server Layer (`packages/forge/src/server/`)

- **Framework:** Hono
- **Purpose:** Session management, authentication, configuration
- **Future:** Multi-client support (e.g., drive from mobile while running on desktop)

### 3. ACP Client Layer (`packages/forge/src/acp/`)

- **Purpose:** Manages ACP agent subprocesses and protocol communication
- **Key Components:**
  - `client.ts` - ACP protocol client using `@agentclientprotocol/sdk`
  - `orchestrator.ts` - Coordinates agent lifecycle
  - `translator.ts` - Translates between agent responses and UI
  - `agents.ts` - Agent registry and configuration
  - `translation/` - Text and tool translation logic

### 4. MCP Integration (`packages/forge/src/mcp/`)

- **Purpose:** Model Context Protocol server management
- ACP agents use MCP servers for tool integration and resources

---

## Monorepo Structure

```
packages/
├── forge/              # Main TUI application (this is where we work)
│   ├── src/
│   │   ├── acp/       # ACP client implementation ⭐
│   │   ├── cli/       # CLI commands + TUI ⭐
│   │   ├── mcp/       # MCP integration
│   │   ├── server/    # HTTP server (Hono)
│   │   ├── provider/  # AI provider abstractions
│   │   ├── lsp/       # Language server protocol client
│   │   ├── config/    # Configuration management
│   │   └── util/      # Shared utilities
├── sdk/js/            # TypeScript SDK (@forge/sdk) - client for HTTP server
├── util/              # Shared utilities (@forge/util)
├── script/            # Build tools (@forge/script)
└── opencode-archive/  # Archived OpenCode packages (DO NOT USE)
```

**⚠️ Important:** `packages/opencode-archive/` contains code moved from the OpenCode fork. It's there for reference only - do NOT use or import from it.

---

## Key Technologies

| Layer               | Tech Stack                                  |
| ------------------- | ------------------------------------------- |
| **Runtime**         | Bun                                         |
| **UI Framework**    | Solid.js (NOT React - see notes)            |
| **TUI Library**     | OpenTUI (`@opentui/core`, `@opentui/solid`) |
| **HTTP Server**     | Hono                                        |
| **Protocol SDK**    | `@agentclientprotocol/sdk`                  |
| **MCP**             | `@modelcontextprotocol/sdk` + `@ai-sdk/mcp` |
| **Build Tool**      | Turbo (monorepo orchestration)              |
| **Package Manager** | Bun workspaces                              |
| **Type System**     | TypeScript + Zod for runtime validation     |

---

## Agent Client Protocol (ACP)

The Agent Client Protocol standardizes communication between code editors/IDEs, and coding agents (programs that use generative AI to autonomously modify code).

Agents run as sub-processes of the code editor, and communicate using JSON-RPC over stdio. The protocol re-uses the JSON representations used in MCP where possible, but includes custom types for useful agentic coding UX elements, like displaying diffs.

**Learn more:** <https://agentclientprotocol.com/llms.txt>

**Our implementation:** `packages/forge/src/acp/` - we manage agent subprocesses and translate protocol messages into UI updates.

## Common Tasks

### Debugging ACP Protocol Issues

- Check `packages/forge/src/acp/translator.ts` for message translation
- Use `Log.create({ service: "acp-client" })` for debugging
- See test fixtures in `packages/forge/test/acp/fixtures/`

---

## Resources

If asked about any of these project, use `mcp__deepwiki__ask_question` to gather information from the repo:

- OpenCode: sst/opencode
- Claude Code ACP: zed-industries/claude-code-acp
- Gemini: google-gemini/gemini-cli

**Agent Client Protocol:** <https://agentclientprotocol.com/llms.txt>
