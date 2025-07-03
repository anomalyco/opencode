# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CH-AI Runtime (formerly OpenCode) is an AI coding agent built for the terminal. It's a monorepo project with four main packages:

```
┌──────────────────────────────────────────────────────┐
│                  CH-AI Runtime                        │
├──────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │   TUI    │  │   CLI    │  │   Web Docs       │  │
│  │  (Go)    │  │  (Bun)   │  │  (Astro)         │  │
│  └─────┬────┘  └─────┬────┘  └────────┬─────────┘  │
│        └──────────────┴────────────────┘            │
│                       ▼                              │
│           ┌─────────────────────┐                   │
│           │   Core API Server   │                   │
│           │   (TypeScript/Hono) │                   │
│           └─────────┬───────────┘                   │
│                     ▼                               │
│     ┌───────────────┴────────────────┐              │
│     │         Tool System            │              │
│     │  (File, Search, Web, LSP, MCP) │              │
│     └───────────────┬────────────────┘              │
│                     ▼                               │
│        ┌────────────┴────────────┐                  │
│        │    Provider System      │                  │
│        │ (Anthropic, OpenAI,    │                  │
│        │  Bedrock, Local)        │                  │
│        └─────────────────────────┘                  │
└──────────────────────────────────────────────────────┘
```

## Commands

### Development
```bash
# Install dependencies
bun install

# Run the development server
bun run packages/opencode/src/index.ts

# Run type checking across all packages
bun run typecheck

# Format code with Prettier
bun run prettier <file>

# Development commands with Bun auth conflict workaround
bun run ./src/index.ts auth login  # Use full path for auth commands
bun run ./src/index.ts run "message"
bun run ./src/index.ts models
```

### Testing
```bash
# Run all tests
cd packages/opencode && bun test

# Run a specific test file
bun test packages/opencode/test/tool/<test-file>.test.ts

# Run tests with watch mode
bun test --watch

# Update snapshots
bun test -u
```

### Building & Release
```bash
# Build Go TUI
cd packages/tui && go build -o opencode cmd/opencode/main.go

# Publish to npm (via GitHub Actions)
# Updates version in package.json files and creates git tag
```

### Documentation Site
```bash
# Start documentation dev server
cd packages/web && bun run dev

# Build documentation
cd packages/web && bun run build

# Preview production build
cd packages/web && bun run preview
```

## Architecture

### Communication Flow
```
Terminal UI (Go) ← HTTP/WebSocket → Core Logic (TypeScript) ← → AI Providers
     │                                      │
     └── SSE for streaming ─────────────────┘
```

### Key Directories

**Core Logic (`packages/opencode/src/`)**
```
src/
├── auth/          # Authentication providers (Anthropic, AWS Bedrock, etc.)
├── cli/           # CLI command implementations
├── tool/          # AI tool implementations 
│   ├── base.ts    # Base tool interface
│   ├── edit.ts    # File editing tool
│   ├── search.ts  # Code search tools
│   └── web.ts     # Web browsing tools
├── server/        # API server using Hono framework
├── provider/      # AI provider integrations
├── session/       # Session management
├── lsp/           # Language Server Protocol integration
└── mcp/           # Model Context Protocol servers
```

**Terminal UI (`packages/tui/`)**
```
tui/
├── cmd/           # Main entry point
├── internal/      
│   ├── app/       # Application state & logic
│   ├── components/# UI components (chat, dialog, diff viewer)
│   ├── theme/     # Theme system (20+ themes)
│   └── layout/    # Responsive layout system
└── pkg/client/    # HTTP client for API communication
```

### Important Patterns

1. **Tool System**: Tools implement the `Tool` interface from `base.ts`. Each tool:
   - Defines input/output schemas using Zod
   - Implements `execute()` method
   - Handles errors with Result pattern
   - Includes comprehensive tests with snapshots

2. **Provider Integration**: AI providers are abstracted in `packages/opencode/src/provider/`:
   - Common interface for all providers
   - Streaming support via SSE
   - Tool calling capabilities
   - Model selection and configuration

3. **Configuration**: 
   - `opencode.json` - Project configuration with experimental hooks
   - `~/.config/opencode/providers.json` - Provider credentials
   - `AGENTS.md` - Project-specific AI instructions

4. **Session Management**: Sessions track:
   - Message history
   - Tool invocations
   - Token usage
   - Costs

## Code Style

- **Prettier** configuration: No semicolons (`"semi": false`)
- **TypeScript**: Strict mode enabled, extends Bun's config
- **Imports**: Use relative imports for local modules
- **Error Handling**: Prefer Result pattern over throwing errors
- **Naming**: 
  - Files: kebab-case
  - Classes/Types: PascalCase
  - Functions/Variables: camelCase

## Testing Approach

- **Framework**: Bun's built-in test runner
- **Location**: `packages/opencode/test/`
- **Structure**: Mirror source structure in test directory
- **Patterns**:
  - Unit tests for individual functions
  - Integration tests for tools
  - Snapshot testing for tool outputs
  - Mock providers for testing

## API Development

The API server (`packages/opencode/src/server/server.ts`) uses Hono framework and provides:
- `/v1/messages` - Main chat endpoint
- `/v1/models` - Available models
- `/v1/providers` - Provider configuration
- SSE streaming for real-time responses

When modifying API endpoints, coordinate with the team for Stainless SDK generation.

## Infrastructure

- **Deployment**: SST v3 to Cloudflare (Workers, R2, D1)
- **Configuration**: `sst.config.ts`
- **Environments**: Development, staging, production
- **Monitoring**: OpenTelemetry support

## Tool Development Guide

When creating a new tool:

1. Create file in `packages/opencode/src/tool/`
2. Define Zod schemas for input/output
3. Implement the Tool interface
4. Add comprehensive error handling
5. Write tests with snapshots
6. Update tool registry in `base.ts`

Example structure:
```typescript
export const myToolDefinition = {
  name: "myTool",
  description: "Tool description",
  inputSchema: z.object({
    // Define inputs
  }),
  outputSchema: z.object({
    // Define outputs
  })
}

export const myTool: Tool<typeof myToolDefinition> = {
  definition: myToolDefinition,
  execute: async (input) => {
    // Implementation
  }
}
```

## Troubleshooting

### Bun Auth Command Conflict
When running with Bun, the "auth" command conflicts with Bun's reserved commands:
```bash
# ❌ Won't work
bun run dev
opencode auth login

# ✅ Use full path
bun run ./src/index.ts auth login
```

### Common Issues
- **Type errors**: Run `bun run typecheck` to check all packages
- **Test failures**: Update snapshots with `bun test -u` if output changes are expected
- **Provider errors**: Check `~/.config/opencode/providers.json` for correct credentials