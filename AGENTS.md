# OpenCode Agent Guidelines

## Project Essence

**OpenCode** is an AI-powered development tool built as a Bun + TypeScript monorepo. It provides a TUI interface for agentic coding tasks, supporting multiple AI providers (OpenAI, Anthropic, Google, etc.), MCP servers, and extensible tool systems. The core architecture uses a namespace-based organization with Zod-validated tools, Hono-based HTTP server, and SolidJS web UI.

## Architecture Graph

```mermaid
graph TD
    subgraph CLI_Entry["CLI Layer"]
        CLI["src/index.ts"] --> Commands["cli/cmd/*.ts"]
        Commands --> Bootstrap["cli/bootstrap.ts"]
    end

    subgraph Core["Core Logic Layer"]
        Config["config/config.ts"]
        Session["session/index.ts"]
        Agent["agent/agent.ts"]
        Tool["tool/tool.ts"]
        Storage["storage/storage.ts"]
        Bus["bus/index.ts"]
    end

    subgraph Tool_System["Tool System"]
        Tool --> Registry["tool/registry.ts"]
        Registry --> Tools["tool/bash.ts, read.ts, write.ts, glob.ts, grep.ts, etc."]
    end

    subgraph Agent_System["Agent System"]
        Agent --> Agents["build, plan, explore, general, etc."]
        Session --> LLM["session/llm.ts"]
        LLM --> Provider["provider/provider.ts"]
    end

    subgraph Server["Server Layer"]
        Server["server/server.ts"]
        Server --> Routes["server/routes/*.ts"]
        Server --> Hono["Hono HTTP Server"]
        Hono --> SSE["SSE Event Stream"]
    end

    subgraph Storage["Storage Layer"]
        Storage --> JSON["JSON File Storage"]
        Storage --> Lock["util/lock.ts"]
    end

    CLI_Entry --> Core
    Core --> Tool_System
    Core --> Agent_System
    Agent_System --> Server
    Storage --> Core
    Bus --> Core

    subgraph Packages["Monorepo Packages"]
        P_OpenCode["packages/opencode - Core"]
        P_App["packages/app - Web UI"]
        P_SDK["packages/sdk - JS SDK"]
        P_Util["packages/util - Utilities"]
        P_Plugin["packages/plugin - Plugin System"]
    end
```

## AI Navigation Map (Critical Files)

| Priority | File                                         | Why It Matters                                                              |
| -------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| **1**    | `packages/opencode/src/index.ts`             | Main CLI entry point with yargs command registration and error handling     |
| **2**    | `packages/opencode/src/server/server.ts`     | Core Hono HTTP server, all API routes, CORS, SSE event stream               |
| **3**    | `packages/opencode/src/tool/tool.ts`         | Tool interface definition (`Tool.define()` pattern) - all tools extend this |
| **4**    | `packages/opencode/src/tool/registry.ts`     | Tool registration and execution engine                                      |
| **5**    | `packages/opencode/src/agent/agent.ts`       | Agent definitions (build, plan, explore, etc.) with permission rules        |
| **6**    | `packages/opencode/src/session/index.ts`     | Session management, message handling, fork/create logic                     |
| **7**    | `packages/opencode/src/config/config.ts`     | Config loading from multiple sources, permission system                     |
| **8**    | `packages/opencode/src/storage/storage.ts`   | JSON file storage with migrations and locking                               |
| **9**    | `packages/opencode/src/provider/provider.ts` | AI provider abstraction (OpenAI, Anthropic, etc.)                           |
| **10**   | `packages/opencode/src/bus/index.ts`         | Event bus for inter-module communication                                    |

**READ FIRST**: Start with `src/index.ts` to understand CLI flow, then `src/tool/tool.ts` and `src/tool/registry.ts` for the tool system, then `src/session/index.ts` for session orchestration.

## Build, Lint, and Typecheck

### Installation

```bash
bun install
```

### Run OpenCode TUI

```bash
bun dev                    # Run against current directory
bun dev .                  # Run against opencode repo root
bun dev <directory>        # Run against specific directory
bun dev --help             # Show all available commands
```

### Run API Server Only

```bash
bun dev serve              # Default port 4096
bun dev serve --port 8080  # Custom port
```

### Run Web UI (Testing UI Changes)

```bash
bun dev serve              # Start server first (required)
bun run --cwd packages/app dev  # Then start web app on port 5173
```

### Run Desktop App

```bash
bun run --cwd packages/desktop tauri dev
```

### Build Standalone Executable

```bash
./packages/opencode/script/build.ts --single
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

### Typecheck

```bash
bun run typecheck          # Root-level (all packages via turbo)
bun run --cwd packages/opencode typecheck  # Per-package
```

### Tests

```bash
bun test                                           # All tests in opencode package
bun test test/tool/tool.test.ts                    # Specific test file
bun run --cwd packages/opencode test              # Unit tests
bun run --cwd packages/app test                   # E2E tests
playwright test                                    # E2E tests in packages/app
playwright test e2e/example.spec.ts               # Specific E2E test
```

### SDK Regeneration (After Server Changes)

```bash
./script/generate.ts
```

## Architectural Guardrails

### Runtime & Format

- **Runtime**: Bun with TypeScript ESM modules
- **Formatting**: Prettier with `semi: false`, `printWidth: 120`

### Imports

- Use relative imports for local modules
- Use named imports: `import { foo } from "bar"` not `import bar from "bar"`
- Avoid default exports where named exports are clearer

### Types

- Avoid `any` type - use precise types
- Use Zod schemas for runtime validation
- Use TypeScript interfaces for type definitions
- Rely on type inference; avoid explicit annotations unless needed for exports

### Naming Conventions

- **Variables/Functions**: camelCase
- **Classes/Namespaces**: PascalCase
- **Constants**: SCREAMING_SNAKE_CASE
- Prefer single-word names when descriptive enough
- Multiple words only when single word is unclear

### Control Flow

- Avoid `else` statements - use early returns
- Avoid `let` - prefer `const` or ternary expressions

**Good:**

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

const foo = condition ? 1 : 2
```

**Bad:**

```ts
function foo() {
  if (condition) return 1
  else return 2
}

let foo
if (condition) foo = 1
else foo = 2
```

### Destructuring

Avoid unnecessary destructuring - use `obj.a` and `obj.b` to preserve context

### Error Handling

- Prefer `.catch()` over `try`/`catch` where possible
- Use Result patterns for tool execution
- Avoid throwing exceptions in tools

### Testing

- Avoid mocks - test actual implementation
- Tests must not duplicate logic

### File Structure Patterns

- **Namespace-based organization**: `Tool.define()`, `Session.create()`
- **All inputs validated with Zod schemas**
- **Logging pattern**: `Log.create({ service: "name" })`
- **Error pattern**: Use `NamedError` from `@opencode-ai/util/error`

### Documentation Practices

- **Feature Design Documents**: Write to `packages/opencode/doc/feat_*.md`
- **Naming**: Use `feat_update_descriptive-name.md` format
- **Content**: Include architecture diagrams, data structures, workflow examples, and implementation steps
- **Purpose**: Document design rationale, API contracts, and integration points for review and future maintenance
- **Location**: All feature documentation goes in `packages/opencode/doc/` directory

### Runtime APIs

Use Bun APIs when available: `Bun.file()`, `Bun.spawn()`, etc.

## Monorepo Structure

```
opencode/
├── packages/opencode/     # Core CLI, tools, agent system, server
├── packages/app/          # Web UI (SolidJS + OpenTUI)
├── packages/sdk/          # JavaScript SDK for TUI communication
├── packages/util/         # Shared utilities
├── packages/plugin/       # Plugin system
├── packages/desktop/      # Tauri desktop app
├── packages/console/      # Console app
├── packages/ui/           # UI components
├── packages/extensions/   # VS Code extension
└── packages/web/          # Web app
```

## Architecture Key Concepts

### Tool System

Tools are defined using `Tool.define(id, init)` where `init` returns description, parameters (Zod schema), and execute function. Tools receive a `Context` with `sessionID`, `messageID`, `agent`, `abort` signal, and can call `ctx.ask()` for permission requests.

### Agent System

Agents are configured in `Config.agent` with `mode` (primary/subagent/all), `permission` rules, `model`, `temperature`, and `prompt`. Built-in agents: `build` (default), `plan` (no edit tools), `explore` (read-only), `general` (subagent for complex tasks).

### Session System

Sessions manage conversation state, messages, and parts. Messages contain roles (user/assistant/tool) and parts (text, reasoning, file). Sessions support forking, compaction, and sharing.

### Event Bus

`Bus.publish(event, properties)` for emitting events, `Bus.subscribe(event, callback)` for listening. Events include `session.created`, `session.updated`, `session.diff`, etc.

### Server API

Hono-based HTTP server with routes for: `/project`, `/session`, `/pty`, `/mcp`, `/config`, `/provider`, `/file`, `/tui`, `/global`. Uses OpenAPI spec generation for API documentation.

### Storage

JSON file storage with locking, migrations, and paths like `storage/session/{projectID}/{sessionID}.json`. Keys are arrays that become file paths.

## General

- **Default branch**: `dev`
- **Always use parallel tools when applicable**
- **Execute requested actions without confirmation** unless blocked by missing info or safety/irreversibility
