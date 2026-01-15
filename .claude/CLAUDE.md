# OpenCode Project Guide

> **AI Assistant Reference**: This file helps AI assistants (like Claude) understand the OpenCode codebase structure and contribute effectively.

## Project Overview

OpenCode is an open-source AI-powered development tool that provides intelligent coding assistance through multiple interfaces (CLI/TUI, desktop app, web). Built with TypeScript and Bun, it features a client-server architecture that's extensible, provider-agnostic, and designed for developers who value control and customization.

**Repository**: https://github.com/anomalyco/opencode
**License**: MIT
**Main Language**: TypeScript
**Runtime**: Bun 1.3+
**Build System**: Turbo (monorepo)

## Quick Start for Contributors

```bash
# Install dependencies
bun install

# Run development server
bun dev

# Run in specific directory
bun dev <directory>

# Type checking
bun typecheck

# Build standalone executable
./packages/opencode/script/build.ts --single
```

## Project Structure

This is a Bun monorepo with multiple packages:

```
opencode/
├── packages/
│   ├── opencode/          # Core CLI and server (MAIN PACKAGE)
│   ├── app/               # Web UI components (SolidJS)
│   ├── desktop/           # Desktop app (Tauri)
│   ├── web/               # Landing page & docs (Astro)
│   ├── sdk/js/            # TypeScript SDK for clients
│   ├── plugin/            # Plugin framework
│   ├── ui/                # Shared UI components
│   ├── util/              # Shared utilities
│   ├── script/            # Build scripts
│   ├── console/           # Enterprise console
│   ├── enterprise/        # Enterprise features
│   ├── slack/             # Slack integration
│   └── function/          # Serverless functions
├── docs/
│   └── design/            # Architecture and design docs
├── infra/                 # Infrastructure as code (SST)
├── script/                # Project scripts
├── themes/                # Color themes
└── [Root Config Files]
```

## Key Package: `packages/opencode`

This is the heart of OpenCode. Structure:

```
packages/opencode/src/
├── index.ts               # CLI entry point (yargs)
├── server/
│   ├── server.ts          # Hono HTTP server setup
│   ├── api/               # API route handlers
│   │   ├── session.ts     # Session CRUD operations
│   │   ├── message.ts     # Message handling & streaming
│   │   ├── provider.ts    # AI provider management
│   │   ├── config.ts      # Configuration API
│   │   └── ...
│   └── stream.ts          # WebSocket/SSE streaming
├── agent/
│   ├── agent.ts           # Agent type definitions
│   ├── runner.ts          # Agent execution engine
│   ├── builtin/           # Built-in agents (build, plan)
│   └── subagent/          # Subagents (general, explore)
├── tool/
│   ├── tool.ts            # Tool registry and types
│   └── builtin/           # 20+ built-in tools
│       ├── read.ts        # File reading
│       ├── write.ts       # File writing
│       ├── edit.ts        # File editing
│       ├── bash.ts        # Shell commands
│       ├── glob.ts        # Pattern matching
│       ├── grep.ts        # Content search
│       ├── task.ts        # Subagent spawning
│       └── ...
├── session/
│   ├── store.ts           # SQLite session storage
│   ├── session.ts         # Session state management
│   └── snapshot.ts        # File snapshot system
├── provider/
│   ├── provider.ts        # Provider abstraction
│   ├── model.ts           # Model configuration
│   └── oauth/             # OAuth integration
├── cli/
│   └── cmd/
│       ├── tui/           # Terminal UI (SolidJS + opentui)
│       ├── serve.ts       # Server mode
│       ├── auth.ts        # Auth commands
│       └── ...
├── lsp/                   # Language Server Protocol client
├── git/                   # Git integration
├── config/                # Configuration system
├── plugin/                # Plugin loading & management
├── fs/                    # File system operations
└── message/               # Message types & handling
```

## Architecture Patterns

### 1. Client-Server Model
- **Server**: Hono-based HTTP server with REST API + WebSocket/SSE streaming
- **Clients**: TUI, desktop app, web app, future mobile app
- **Communication**: RESTful API for operations, streaming for real-time updates

### 2. Agent System
- **Primary Agents**: `build` (full access), `plan` (read-only)
- **Subagents**: `general` (multi-step tasks), `explore` (fast search)
- **Agent Runner**: Orchestrates AI calls, tool execution, and streaming
- **Permissions**: Agent-level and tool-level access control

### 3. Tool System
- **Registry**: Central tool registration and discovery
- **Categories**: File ops, shell, search, AI-powered, custom
- **Permissions**: allow/deny/ask per tool per agent
- **Extensibility**: Plugin tools, MCP tools, project tools

### 4. Session Management
- **Storage**: SQLite for messages and metadata
- **Snapshots**: File state tracking for undo/fork/revert
- **Compaction**: AI-powered summarization to manage context length
- **Operations**: Create, resume, fork, summarize, share

## Code Style & Conventions

From `STYLE_GUIDE.md`:

1. **Functions**: Keep logic within a single function unless breaking it out adds clear benefits
2. **Destructuring**: Avoid unnecessary destructuring
3. **Control flow**: Avoid `else` statements
4. **Error handling**: Prefer `.catch(...)` over `try/catch`
5. **Types**: Use precise types, avoid `any`
6. **Variables**: Prefer immutable patterns, avoid `let`
7. **Naming**: Concise single-word identifiers when descriptive
8. **Runtime APIs**: Use Bun helpers (e.g., `Bun.file()`)

## Common Tasks

### Adding a New Tool

1. Create tool in `packages/opencode/src/tool/builtin/my-tool.ts`:
```typescript
import { z } from 'zod'
import type { Tool } from '../tool'

export const myTool: Tool = {
  name: 'my-tool',
  description: 'Tool description',
  parameters: z.object({
    param: z.string().describe('Parameter description')
  }),
  async execute(input) {
    // Implementation
    return { content: 'Result' }
  }
}
```

2. Register in `packages/opencode/src/tool/builtin/index.ts`
3. Add to relevant agent permissions
4. Test with `bun dev`

### Adding a New Agent

1. Create agent config in `.opencode/agent/my-agent.md`:
```markdown
---
model: claude-sonnet-4
temperature: 0.7
tools:
  bash: ask
  read: allow
  write: deny
---

System prompt for the agent...
```

2. Agent automatically loaded from `.opencode/agent/` directory

### Modifying the API

1. Update routes in `packages/opencode/src/server/api/`
2. Run `./script/generate.ts` to regenerate SDK
3. Update SDK types in `packages/sdk/js/`

### Working on TUI

1. TUI code: `packages/opencode/src/cli/cmd/tui/`
2. Shared UI components: `packages/app/src/`
3. Run: `bun dev` for full TUI experience
4. Or: `bun run --cwd packages/app dev` for web-only testing

### Building for Release

```bash
# Single platform
./packages/opencode/script/build.ts --single

# All platforms (requires cross-compilation setup)
./packages/opencode/script/build.ts

# Desktop app
bun run --cwd packages/desktop tauri build
```

## Key Concepts

### Agent Permissions

Each agent has granular control over tool access:
- **allow**: Execute without prompting
- **deny**: Block execution
- **ask**: Prompt user for approval

### Message Streaming

Messages stream in parts:
- **text**: Display content
- **tool_use**: Tool invocation request
- **tool_result**: Tool execution result
- **thinking**: Internal reasoning (optional)

### Session Compaction

When sessions grow large:
1. AI summarizes old messages
2. Original messages replaced with summary
3. Context window managed automatically
4. Recent messages always preserved

### File Snapshots

Track file states for:
- Undo/redo operations
- Session forking
- Diff visualization
- State restoration

## Testing

```bash
# Run tests
bun test

# Run tests in specific package
bun run --cwd packages/opencode test

# Type checking
bun typecheck
```

Test files: `*.test.ts` alongside source files

## Important Files

### Configuration
- `.opencode/opencode.jsonc` - Project configuration
- `package.json` - Monorepo workspace setup
- `turbo.json` - Build pipeline
- `tsconfig.json` - TypeScript configuration

### Documentation
- `README.md` - Project overview
- `CONTRIBUTING.md` - Contribution guidelines
- `AGENTS.md` - Agent system docs
- `STYLE_GUIDE.md` - Code style guide
- `docs/design/README.md` - Architecture documentation

### Entry Points
- `packages/opencode/src/index.ts` - CLI entry
- `packages/opencode/src/server/server.ts` - Server setup
- `packages/opencode/src/cli/cmd/tui/index.tsx` - TUI entry
- `packages/app/src/index.tsx` - Web app entry
- `packages/desktop/src/main.tsx` - Desktop app entry

## Development Workflow

1. **Branch from `dev`**: Main development branch
2. **Issue First**: Reference an issue in PR
3. **Small PRs**: Keep focused and reviewable
4. **Explain Changes**: Why and how, not AI-generated walls
5. **Follow Style**: Match existing code patterns
6. **Test Changes**: Verify functionality
7. **PR Title**: Use conventional commits (feat:, fix:, docs:, etc.)

## Common Pitfalls

1. **Don't Edit Generated Files**: Run `./script/generate.ts` instead
2. **Respect .gitignore**: Don't commit build artifacts
3. **Use Bun APIs**: Prefer Bun.file() over fs.readFile
4. **Avoid `let`**: Use const and immutable patterns
5. **Type Everything**: No `any` types
6. **Check Permissions**: Tool execution respects agent permissions
7. **Test TUI Changes**: Run full `bun dev`, not just web app

## Getting Help

- **Discord**: https://opencode.ai/discord
- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Design conversations
- **Code Comments**: Many files have inline documentation

## For AI Assistants

When helping with this codebase:

1. **Read First**: Always read files before suggesting changes
2. **Follow Patterns**: Match existing code style and architecture
3. **Be Specific**: Reference exact file paths and line numbers
4. **Explain Trade-offs**: Discuss design decisions
5. **Test Mentally**: Consider edge cases and error handling
6. **Check Dependencies**: Understand package relationships
7. **Respect Style**: Follow STYLE_GUIDE.md conventions
8. **Understand Design**: Consult docs/design/README.md for architecture decisions

## Package Dependencies

```
opencode (CLI/Server)
├── @opencode-ai/util
├── @opencode-ai/plugin
├── @opencode-ai/script
└── @opencode-ai/sdk

app (Web UI)
├── @opencode-ai/sdk
├── @opencode-ai/ui
└── @opencode-ai/util

desktop (Desktop App)
├── @opencode-ai/app
└── @opencode-ai/ui
```

## Build Pipeline (Turbo)

```
turbo typecheck → Type check all packages
turbo test → Run all tests
turbo build → Build all packages
```

Individual packages can be built independently:
```bash
bun run --cwd packages/opencode build
bun run --cwd packages/app build
bun run --cwd packages/desktop build
```

## Release Process

1. Version bump in package.json files
2. Update CHANGELOG (if exists)
3. Run `./script/generate.ts`
4. Build: `./packages/opencode/script/build.ts`
5. Test builds locally
6. Create GitHub release
7. Publish to npm
8. Update package managers (Homebrew, Scoop, etc.)

## Additional Resources

- **Official Docs**: https://opencode.ai/docs
- **API Documentation**: Auto-generated OpenAPI docs
- **Examples**: `.opencode/` directory for custom extensions
- **GitHub Actions**: `.github/workflows/` for CI/CD setup

---

**Last Updated**: 2026-01-14
**OpenCode Version**: 1.1.19
**Maintained By**: OpenCode Team & Community

For more detailed information:
- Deep technical understanding: `doc/learn/README.md`
- Architecture and design: `doc/design/README.md`
- Contribution process: `CONTRIBUTING.md`
