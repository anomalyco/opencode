# CLAUDE.md

This document provides an overview of the LotionCode codebase for AI assistants.

## Project Overview

LotionCode is an open-source AI coding agent. It's a terminal-based (TUI) application built with SolidJS that supports multiple AI providers (Anthropic, OpenAI, Google, etc.) and includes features like LSP integration, MCP server support, and a client/server architecture.

## Quick Reference

```bash
# Install dependencies
bun install

# Development (runs TUI in packages/lotioncode)
bun dev

# Run against a different directory
bun dev <directory>

# Start API server only
bun dev serve --port 4096

# Run typechecking
bun typecheck

# Run tests (from package directory, NOT root)
cd packages/lotioncode && bun test
cd packages/app && bun test

# Regenerate SDK after API changes
./script/generate.ts

# Build standalone executable
./packages/lotioncode/script/build.ts --single
```

## Repository Structure

```
lotioncode/
├── packages/
│   ├── lotioncode/          # Core CLI & business logic (main package)
│   │   ├── src/
│   │   │   ├── cli/       # CLI commands and TUI
│   │   │   ├── tool/      # Agent tools (bash, edit, read, etc.)
│   │   │   ├── provider/  # AI provider integrations
│   │   │   ├── session/   # Session management
│   │   │   ├── mcp/       # MCP server support
│   │   │   ├── lsp/       # LSP client
│   │   │   └── server/    # HTTP API server
│   │   └── test/          # Unit tests
│   ├── app/               # Shared web UI components (SolidJS)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   └── context/
│   │   └── e2e/           # Playwright E2E tests
│   ├── desktop/           # Native desktop app (Tauri wrapper)
│   ├── ui/                # Shared UI components library
│   ├── sdk/js/            # Generated JavaScript SDK (@lotioncode-ai/sdk)
│   ├── plugin/            # Plugin system (@lotioncode-ai/plugin)
│   ├── util/              # Shared utilities (@lotioncode-ai/util)
│   ├── console/           # Console web app (app, core, function, mail)
│   ├── web/               # Marketing website
│   └── docs/              # Documentation site
├── sdks/vscode/           # VS Code extension
├── script/                # Build & maintenance scripts
├── .lotioncode/             # Project-specific LotionCode config
│   ├── agent/             # Custom agent definitions
│   ├── tool/              # Custom tool definitions
│   └── lotioncode.jsonc     # Project configuration
└── infra/                 # Infrastructure code
```

## Development Workflow

### Prerequisites

- **Bun 1.3+** (specified in `package.json` as `packageManager: bun@1.3.5`)
- Pre-push hook validates Bun version matches `package.json`

### Key Commands

| Command | Description |
|---------|-------------|
| `bun dev` | Run LotionCode TUI (development mode) |
| `bun dev serve` | Start headless API server on port 4096 |
| `bun dev web` | Start server + open web interface |
| `bun typecheck` | Run TypeScript type checking (via turbo) |
| `bun run --cwd packages/app dev` | Run web app dev server |
| `bun run --cwd packages/desktop tauri dev` | Run desktop app |

### Testing

- **Unit tests**: Use `bun test` from the specific package directory
- **E2E tests**: Use Playwright in `packages/app`
- **Do NOT run tests from repo root** - it will fail by design

```bash
# Unit tests
cd packages/lotioncode && bun test

# E2E tests
cd packages/app && bun test:e2e

# E2E with UI
cd packages/app && bun test:e2e:ui
```

### Code Generation

After modifying API endpoints in `packages/lotioncode/src/server/`:

```bash
./script/generate.ts
```

This regenerates the SDK and OpenAPI spec.

## Code Style Guide

### General Principles

- **Single functions**: Keep logic in one function unless composable/reusable
- **Avoid `try/catch`**: Use `.catch()` instead where possible
- **No `any` types**: Reach for precise types
- **Single-word names**: Prefer concise variable/function names
- **Use Bun APIs**: Prefer `Bun.file()` and similar helpers
- **Type inference**: Rely on inference; avoid explicit annotations unless needed
- **Functional patterns**: Use `flatMap`, `filter`, `map` over for loops
- **Avoid `else`**: Use early returns instead
- **Prefer `const`**: Use ternaries or early returns over `let`

### Naming

```typescript
// Good
const foo = 1
function journal(dir: string) {}
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

```typescript
// Good - preserve context with dot notation
obj.a
obj.b

// Bad - unnecessary destructuring
const { a, b } = obj
```

### Control Flow

```typescript
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names:

```typescript
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Formatting & Linting

- **Prettier**: Semi-colon free, 120 char print width
- **EditorConfig**: 2-space indent, LF line endings, UTF-8
- **TypeScript**: Uses `@tsconfig/bun` base config
- **Typechecker**: Uses `tsgo` (native TypeScript compiler)

```json
// Prettier config (in package.json)
{
  "semi": false,
  "printWidth": 120
}
```

## Testing Guidelines

- **Avoid mocks**: Test actual implementation
- **Don't duplicate logic**: Tests should verify behavior, not reimplement it
- Use `Instance.provide()` for setting up test contexts
- Use `tmpdir()` fixture for temporary directories

## Git Conventions

### Branch

- Default branch is `dev`

### Commit Messages / PR Titles

Follow conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `chore:` - Maintenance
- `refactor:` - Code refactoring
- `test:` - Tests

Optional scope: `feat(app):`, `fix(desktop):`, `chore(lotioncode):`

### PR Requirements

- All PRs must reference an existing issue
- Keep PRs small and focused
- Include screenshots/videos for UI changes
- Explain verification steps for logic changes
- No AI-generated walls of text

## Architecture Notes

### Client/Server Architecture

LotionCode runs as a server that exposes an HTTP API. Clients (TUI, web app, desktop app) connect to this server.

```bash
# Server
bun dev serve --port 4096

# Connect TUI client
lotioncode attach http://localhost:4096
```

### AI Providers

Supported providers include:
- LotionCode (default)
- Anthropic Claude
- OpenAI
- Google (Gemini, Vertex)
- Azure OpenAI
- Amazon Bedrock
- Groq, Mistral, Cohere, Perplexity, xAI, and more

### Tools

Agent tools are defined in `packages/lotioncode/src/tool/`:
- `bash.ts` - Command execution
- `edit.ts` - File editing
- `read.ts` - File reading
- `write.ts` - File writing
- `grep.ts` - Content search
- `glob.ts` - File pattern matching
- `task.ts` - Subagent spawning
- And more...

Each tool has a `.ts` implementation and `.txt` description file.

### Agents

Built-in agents:
- **build** - Default, full access agent for development
- **plan** - Read-only agent for analysis/exploration
- **general** - Subagent for complex searches (invoked via `@general`)

Custom agents can be defined in `.lotioncode/agent/`.

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `solid-js` | UI framework |
| `@opentui/solid` | TUI components |
| `hono` | HTTP server framework |
| `zod` | Schema validation |
| `ai` | Vercel AI SDK for providers |
| `web-tree-sitter` | Code parsing |
| `@modelcontextprotocol/sdk` | MCP support |
| `tauri` | Desktop app framework |
| `playwright` | E2E testing |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LOTIONCODE_DISABLE_SHARE` | Disable share functionality |
| `LOTIONCODE_DISABLE_LSP_DOWNLOAD` | Skip LSP binary downloads |
| `LOTIONCODE_DISABLE_DEFAULT_PLUGINS` | Skip default plugin loading |
| `LOTIONCODE_TEST_HOME` | Override home directory for tests |

## Important Notes

1. **Always use parallel tools when applicable** - The codebase emphasizes concurrent operations
2. **Prefer automation** - Execute requested actions without confirmation unless blocked
3. **Run typecheck before push** - Pre-push hook enforces this
4. **Tests must pass** - CI runs on all PRs
5. **UI/core features need design review** - Discuss with maintainers first
