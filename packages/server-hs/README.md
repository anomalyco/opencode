# opencode-server (Haskell)

Haskell implementation of the OpenCode server backend.

## Building

```bash
nix develop --command cabal build
```

## Running

```bash
nix develop --command cabal run
```

Server listens on port 4096.

## Architecture

```
src/
├── Main.hs              # Entry point, Warp server setup
├── Api.hs               # Servant API type definitions
├── Handlers.hs          # Request handlers
├── State.hs             # AppState with Bus, Storage, PTY manager
│
├── Tool/                # Tool execution framework
│   ├── Types.hs         # Input types (ReadInput, BashInput, etc.)
│   ├── Defs.hs          # Anthropic API tool definitions (JSON schemas)
│   ├── Exec.hs          # Tool executors (file ops, bash, fd, rg)
│   └── Tool.hs          # Re-export module
│
├── LLM/                 # LLM provider integrations
│   ├── Types.hs         # Message, ToolUse, ToolResult, ChatRequest/Response
│   ├── Anthropic.hs     # Direct Anthropic API client
│   └── OpenRouter.hs    # OpenRouter API client (streaming via curl -4)
│
├── Agent/               # Agent definitions and permissions
│   ├── Types.hs         # Agent, PermissionRuleset
│   └── Agent.hs         # Built-in agents (armed, locked, explore, etc.)
│
├── Bus/                 # Event bus for SSE
│   ├── Bus.hs           # Pub/sub implementation
│   └── Event.hs         # Event types
│
├── Pty/                 # PTY session management
│   ├── Types.hs         # PtySession, PtyManager
│   └── Pty.hs           # PTY creation, resize, WebSocket bridge
│
├── Sandbox/             # Sandbox isolation (bwrap + overlayfs)
│   ├── Types.hs         # SandboxConfig
│   └── Sandbox.hs       # Namespace setup, overlay management
│
├── Proxy/               # MITM proxy for LLM traffic inspection
│   ├── Types.hs         # ProxyConfig
│   └── Proxy.hs         # HTTP proxy, token counting
│
├── Session/             # Session management
├── Message/             # Message types
├── Storage/             # Persistence layer
├── Config/              # Configuration
├── Provider/            # Provider definitions
└── Log.hs               # Structured logging (Katip, JSON to stdout)
```

## Tool Execution

The `Tool` module provides the framework for executing LLM tool calls:

### Supported Tools

| Tool    | Description                                    |
| ------- | ---------------------------------------------- |
| `read`  | Read file/directory contents with line numbers |
| `write` | Write content to file                          |
| `edit`  | Replace oldString with newString in file       |
| `bash`  | Execute shell command with timeout             |
| `glob`  | Find files by pattern (uses `fd`)              |
| `grep`  | Search file contents (uses `rg`)               |

### Flow

1. LLM returns `stop_reason: "tool_use"` with `tool_use` content blocks
2. Server parses `ToolUse` from response
3. `Tool.Exec.executeToolUse` runs the tool and returns `ToolResult`
4. Results sent back as `tool_result` content blocks
5. Conversation continues until `stop_reason: "end_turn"`

### Adding New Tools

1. Add input type to `Tool/Types.hs`
2. Add `FromJSON` instance for parsing
3. Add tool definition to `Tool/Defs.hs` with JSON schema
4. Add executor to `Tool/Exec.hs`
5. Wire into `execute` dispatcher

## Environment Variables

| Variable             | Description                            |
| -------------------- | -------------------------------------- |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM calls       |
| `ANTHROPIC_API_KEY`  | Direct Anthropic API key (alternative) |

## Dependencies

External tools used by executors:

- `fd` - fast file finder (glob)
- `rg` - ripgrep (grep)
- `curl` - HTTP client (streaming with IPv4 flag)
- `bwrap` - bubblewrap for sandboxing (optional)

## TODO

See [TODO.md](./TODO.md) for remaining work.
