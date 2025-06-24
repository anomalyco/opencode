# OpenCode AI Agent Guidelines

## Quick Start Commands

- **Install Dependencies**: `bun install` (uses exact versions, workspace catalog)
- **Development Mode**: `bun run dev` (starts opencode CLI in development)
- **Typecheck All**: `bun run typecheck` (validates TypeScript across all packages)
- **Test Suite**: `bun test` (runs Bun test runner with snapshots)
- **Single Test**: `bun test test/tool/tool.test.ts` (specific test file)
- **Web Development**: `cd packages/web && bun run dev` (Astro docs site)
- **Infrastructure Deploy**: `bun sst deploy --stage=dev` (Cloudflare deployment)
- **TUI Development**: `cd packages/tui && go run ./cmd/opencode/main.go` (Go TUI)
- **API Client Regeneration**: `cd packages/tui && go generate ./pkg/client/` (after server changes)

## Architecture Overview

**Monorepo Structure:**
- `packages/opencode/`: Core TypeScript CLI/server (Bun runtime, primary development focus)
- `packages/tui/`: Go terminal interface (Bubble Tea, communicates via HTTP with TS server)
- `packages/web/`: Astro documentation site (Starlight theme, Cloudflare Pages)
- `packages/function/`: Cloudflare Workers API endpoints
- `infra/`: SST infrastructure as code (TypeScript, Cloudflare-first)

**Technology Stack:**
- **Runtime**: Bun 1.2.14+ (preferred), Node.js fallback, Go 1.24+
- **Package Management**: Bun workspaces with catalog for shared dependencies
- **Frontend**: Astro 5.x with Solid.js, Starlight documentation theme
- **Backend**: Hono server framework, Cloudflare Workers runtime
- **Infrastructure**: SST v3 with Cloudflare (Workers, Pages, R2, Durable Objects)
- **Type Safety**: Zod schemas with OpenAPI generation, TypeScript 5.8+

## Code Style & Development Principles

**Core Patterns:**
- **Namespace Organization**: Use `Tool.define()`, `App.provide()`, `Session.create()` patterns
- **Functional Style**: Prefer `const`, avoid unnecessary destructuring, minimize `let` usage
- **Error Handling**: Result patterns over exceptions, avoid `try`/`catch` in tools
- **Type Safety**: Zod validation at boundaries, avoid `any` type, leverage inference
- **Native APIs**: Prefer Bun APIs (`Bun.file()`, `Bun.spawn()`) over Node.js equivalents

**File & Import Conventions:**
- **Imports**: Relative paths for local modules, named imports preferred
- **Naming**: camelCase for variables/functions, PascalCase for classes/namespaces
- **File Structure**: Mirror namespace organization, group by feature/domain
- **Extensions**: `.ts` for TypeScript, `.go` for Go, `.astro` for Astro components

**Control Flow Guidelines:**
- **Early Returns**: Use guard clauses instead of deep nesting
- **Conditional Logic**: Minimize `else` statements, prefer explicit conditions
- **Single Responsibility**: Keep functions focused unless composable/reusable
- **Composition**: Favor small, composable functions over large monoliths

**IMPORTANT Development Rules:**
- Try to keep things in one function unless composable or reusable
- DO NOT do unnecessary destructuring of variables
- DO NOT use `else` statements unless necessary
- DO NOT use `try`/`catch` if it can be avoided
- AVOID using `any` type
- AVOID `let` statements
- PREFER single word variable names where possible
- Use as many Bun APIs as possible like `Bun.file()`

## Tool Development Framework

**Tool Interface Implementation:**
```typescript
export const MyTool = Tool.define({
  id: "my-tool",
  description: "Tool description from .txt file",
  parameters: z.object({
    input: z.string().describe("Parameter description"),
  }),
  async execute(params, ctx) {
    // Implementation with proper error handling
    return { output: "result", metadata: { title: "..." } }
  }
})
```

**Context & Metadata:**
- **Context**: Use `Tool.Context<Metadata>` with sessionID, messageID, abort signal
- **File Operations**: Use `Bun.file()` for file I/O, respect size limits (250KB for read)
- **Validation**: All inputs validated with Zod schemas before execution
- **Metadata**: Return structured metadata for UI display and caching
- **Error Messages**: Provide helpful suggestions for file not found errors

## API & Client Architecture

**Server-Client Communication:**
- **Protocol**: HTTP/JSON between Go TUI and TypeScript server
- **Generation**: OpenAPI specs auto-generated from Zod schemas
- **Type Safety**: Go client types generated from OpenAPI spec
- **Workflow**: Modify `packages/opencode/src/server/server.ts` → run `go generate ./pkg/client/`

**State Management:**
- **Global Paths**: XDG Base Directory specification (config, data, cache, state)
- **App Context**: Git-aware project detection with isolated state
- **Session Persistence**: Project-specific session data and file tracking
- **Provider Authentication**: Secure credential storage in user config directory
- **Logging**: Use `Log.create({ service: "name" })` pattern
- **Storage**: Use `Storage` namespace for persistence

## Testing & Quality Assurance

**Test Framework & Patterns:**
- **Runner**: Bun test with built-in snapshot testing
- **Isolation**: Use `App.provide({ cwd })` for test environment isolation
- **Mocking**: Create test contexts with mock sessionID and abort signals
- **Coverage**: Focus on tool execution paths, error conditions, edge cases

**Quality Gates:**
- **Pre-commit**: Automatic typecheck via git hooks (`scripts/hooks`)
- **CI/CD**: GitHub Actions with Bun setup and SST deployment
- **Type Safety**: Strict TypeScript configuration across all packages
- **Code Formatting**: Prettier with semicolon-free style

## Deployment & Infrastructure

**Cloudflare Platform:**
- **Workers**: API functions with Durable Objects for real-time features
- **Pages**: Static site deployment for documentation
- **R2**: Object storage for file uploads and sharing
- **Domains**: opencode.ai (prod), dev.opencode.ai (dev), [stage].dev.opencode.ai

**Deployment Workflow:**
- **Stages**: Branch-based deployment (dev, production)
- **Infrastructure**: SST handles Cloudflare resource provisioning
- **Environment**: Automatic variable injection and secret management
- **Monitoring**: Cloudflare Analytics and logging integration

## Configuration & Customization

**Agent Configuration Discovery:**
- **Project-Level**: `AGENTS.md`, `CLAUDE.md` in project root
- **Global Config**: `~/.config/opencode/AGENTS.md`
- **Legacy Support**: `CONTEXT.md`, `.cursorrules`, `.cursor/rules/*.mdc`
- **Priority**: Project-specific overrides global configuration
- **Custom Prompts**: Support for AGENTS.md, CLAUDE.md in project root or global config

**Development Environment:**
- **IDE Setup**: TypeScript language server, Go language server
- **Extensions**: Astro extension for .astro files, Go extension for TUI development
- **Debugging**: Bun debugger for TypeScript, delve for Go debugging
- **Hot Reload**: Bun watch mode for TypeScript, Astro dev server for web

## Performance & Optimization

**File Operations:**
- **Size Limits**: 250KB for file reading, truncation with helpful messages
- **Streaming**: Use Bun's streaming APIs for large file operations
- **Caching**: Leverage file modification times and content hashing
- **Concurrency**: Utilize Bun's async/await and Go's goroutines appropriately

**Build Optimization:**
- **Bundle Size**: Minimize dependencies, use tree-shaking effectively
- **Compilation**: Leverage Bun's fast compilation for development
- **Static Assets**: Optimize images and fonts for web deployment
- **Code Splitting**: Astro's automatic code splitting for optimal loading

This configuration enables immediate, context-aware development across the entire OpenCode ecosystem while maintaining architectural consistency and modern development practices.