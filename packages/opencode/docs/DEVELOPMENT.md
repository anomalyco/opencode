# Development Guide

## Prerequisites

- [Bun](https://bun.sh) >= 1.1
- Git
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for code search
- [tsgo](https://github.com/nicolo-ribaudo/tc39-proposal-type-annotations) (TypeScript native preview, for type checking)

## Getting Started

### Setup

```bash
git clone https://github.com/opencode-ai/opencode.git
cd opencode
bun install
```

### Running

```bash
# Development mode (with hot reload)
bun run dev

# Or directly
bun run --conditions=browser ./src/index.ts
```

### Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test test/auth/auth.test.ts

# Run tests matching pattern
bun test --grep "OAuth"
```

### Type Checking

```bash
bun run typecheck  # Uses tsgo --noEmit
```

### Building

```bash
bun run build  # Runs script/build.ts
```

## Project Structure

### Source Code (`src/`)

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `acp/` | Agent Client Protocol | `agent.ts`, `session.ts` |
| `agent/` | AI agent main loop | `agent.ts` |
| `auth/` | API key management & OAuth | `index.ts` |
| `bus/` | Event bus for internal messaging | |
| `cli/` | CLI commands & TUI | `cmd/*.ts`, `cmd/tui/` |
| `command/` | Command definitions | |
| `config/` | Configuration system | `config.ts` |
| `env/` | Environment variable handling | |
| `file/` | File operations & ripgrep | |
| `flag/` | Feature flags | `flag.ts` |
| `format/` | Output formatting | |
| `global/` | Global state management | |
| `id/` | ID generation (ULID) | |
| `ide/` | IDE integration | |
| `installation/` | Installation management | |
| `lsp/` | Language Server Protocol client | |
| `mcp/` | MCP integration | `index.ts`, `auth.ts`, `sanitize.ts` |
| `patch/` | Patch/diff operations | |
| `permission/` | Permission system | `next.ts`, `arity.ts` |
| `plugin/` | Plugin system | |
| `project/` | Project/instance management | |
| `provider/` | LLM provider adapters | `provider.ts`, `transform.ts`, `models.ts` |
| `pty/` | Pseudo-terminal management | |
| `question/` | User question prompts | |
| `scheduler/` | Task scheduling | |
| `server/` | Hono HTTP/WebSocket server | `server.ts`, `event.ts`, `audit.ts` |
| `session/` | Session management | `index.ts`, `prompt.ts` |
| `share/` | Session sharing | |
| `shell/` | Shell integration | |
| `skill/` | Skills system | |
| `snapshot/` | Git snapshot management | |
| `storage/` | Persistent key-value storage | |
| `tool/` | Built-in tools | `bash.ts`, `read.ts`, `write.ts`, etc. |
| `util/` | Shared utilities | `wildcard.ts`, `crypto.ts`, `log.ts`, etc. |
| `worktree/` | Git worktree management | |

### Tests (`test/`)

Tests mirror the `src/` structure. Uses `bun:test` framework.

```
test/
├── acp/              # ACP protocol tests
├── agent/            # Agent loop tests
├── auth/             # Authentication tests
├── cli/              # CLI & TUI tests
│   └── tui/          # Transcript, GitHub remote tests
├── config/           # Configuration tests
├── file/             # Ripgrep, path traversal, ignore tests
├── flag/             # Feature flag tests
├── global/           # Global state tests
├── id/               # ID generation tests
├── ide/              # IDE integration tests
├── lsp/              # LSP client tests
├── mcp/              # MCP OAuth, headers tests
├── memory/           # Abort/leak tests
├── patch/            # Patch operation tests
├── permission/       # Permission (next, arity) tests
├── plugin/           # Plugin tests (codex, auth-override)
├── project/          # Project detection tests
├── provider/         # Provider, transform, copilot tests
├── question/         # Question tool tests
├── server/           # Server security, session tests
├── session/          # Session, compaction, retry, LLM tests
├── shell/            # Shell integration tests
├── skill/            # Skill system tests
├── snapshot/         # Snapshot tests
├── storage/          # Storage tests
├── tool/             # Tool tests (bash, read, grep, etc.)
└── util/             # Utility tests (wildcard, lock, format, etc.)
```

### Test Utilities

- `test/preload.ts` — Test preload/setup script
- `test/fixture/` — Test fixtures and sample data

## Code Style

- **Language**: TypeScript (ES2023+, Bun runtime)
- **Modules**: Namespace-based organization (e.g., `export namespace Provider { ... }`)
- **Validation**: Zod schemas for runtime type checking
- **Error Handling**: Result pattern (`{ ok: true, value } | { ok: false, error }`)
- **DI**: `App.provide()` for dependency injection
- **Logging**: `Log.create({ service: "module-name" })` for structured logging
- **Storage**: `Storage` namespace for persistent key-value storage

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `oauth-callback.ts` |
| Classes/Types | PascalCase | `ToolRegistry` |
| Functions/Variables | camelCase | `getUserData` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| Namespaces | PascalCase | `McpSanitize` |

### Architecture Patterns

- **Namespace pattern**: Core modules are organized as TypeScript namespaces (`export namespace X { ... }`) rather than classes
- **Tool registration**: Tools implement the `Tool.Info` interface with an `execute()` method
- **Permission checks**: Use `ctx.ask()` to request user approval before destructive operations
- **File operations**: `FileTime.withLock()` for atomic file operations
- **Path safety**: `Instance.containsPath()` for sandbox enforcement, preventing access outside the project directory
- **SDK generation**: After modifying server endpoints in `src/server/server.ts`, run `./script/generate.ts` to regenerate the `@opencode-ai/sdk` client

### Imports

- Use relative imports for local modules
- Named imports preferred over default imports
- Example: `import { Config } from "../config/config"`

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(tool): add multi-file edit support
fix(mcp): resolve OAuth CSRF vulnerability
docs: update development guide
test(auth): add API key roundtrip tests
refactor(config): split into schema/loader modules
chore: bump dependency versions
```

## Adding a New Tool

1. Create `src/tool/my-tool.ts` implementing `Tool.Info`
2. Create `src/tool/my-tool.txt` with the tool description (used as system prompt)
3. Register in `src/tool/registry.ts`
4. Add tests in `test/tool/my-tool.test.ts`
5. Add permission handling via `ctx.ask()` for operations that modify the filesystem or execute commands

### Tool Structure Example

```typescript
import { Tool } from "./tool"
import z from "zod"

export const MyToolInfo: Tool.Info = {
  name: "my_tool",
  description: "Description of what my tool does",
  parameters: z.object({
    input: z.string().describe("The input parameter"),
  }),
  async execute(ctx, params) {
    // Request permission for destructive operations
    const approved = await ctx.ask({
      tool: "my_tool",
      message: `Allow my_tool to process: ${params.input}?`,
    })
    if (!approved) return { error: "User denied permission" }

    // Tool logic here
    return { result: "success" }
  },
}
```

## Adding a New Provider

1. Install the AI SDK package: `bun add @ai-sdk/provider-name`
2. Add the import and factory in `src/provider/provider.ts` under `BUNDLED_PROVIDERS`
3. Add model definitions in `src/provider/models.ts`
4. If the provider needs custom initialization logic, add an entry in `CUSTOM_LOADERS`
5. Add type declarations if needed in `src/vendor.d.ts`
6. Add tests in `test/provider/`

### Currently Bundled Providers

The following provider SDKs are bundled and available without dynamic import:

- `@ai-sdk/anthropic` — Anthropic (Claude)
- `@ai-sdk/openai` — OpenAI (GPT, o-series)
- `@ai-sdk/google` — Google Generative AI (Gemini)
- `@ai-sdk/google-vertex` — Google Vertex AI
- `@ai-sdk/amazon-bedrock` — Amazon Bedrock
- `@ai-sdk/azure` — Azure OpenAI
- `@ai-sdk/xai` — xAI (Grok)
- `@ai-sdk/groq` — Groq
- `@ai-sdk/mistral` — Mistral AI
- `@ai-sdk/deepinfra` — DeepInfra
- `@ai-sdk/cerebras` — Cerebras
- `@ai-sdk/cohere` — Cohere
- `@ai-sdk/togetherai` — Together AI
- `@ai-sdk/perplexity` — Perplexity
- `@ai-sdk/vercel` — Vercel AI Gateway
- `@ai-sdk/gateway` — AI Gateway
- `@ai-sdk/openai-compatible` — OpenAI-compatible endpoints
- `@openrouter/ai-sdk-provider` — OpenRouter
- `@gitlab/gitlab-ai-provider` — GitLab Duo
- GitHub Copilot (custom OpenAI-compatible implementation)

## Server Development

The HTTP/WebSocket server is built with [Hono](https://hono.dev/):

- `src/server/server.ts` — Route definitions and server setup
- `src/server/event.ts` — WebSocket event streaming
- `src/server/audit.ts` — Audit logging
- `src/server/rate-limit.ts` — Rate limiting
- `src/server/mdns.ts` — mDNS service discovery

After modifying server routes, regenerate the SDK:

```bash
bun run ./script/generate.ts
```

## Useful Commands Reference

| Command | Description |
|---------|-------------|
| `bun install` | Install dependencies |
| `bun run dev` | Start development mode |
| `bun run build` | Build for production |
| `bun run typecheck` | Run type checker (tsgo) |
| `bun test` | Run all tests |
| `bun test test/path/file.test.ts` | Run a specific test |
| `bun run clean` | Remove node_modules and dist |
