# OpenCode Agents

OpenCode supports specialized agents for different development tasks. Agents are invoked with `@agent-name` syntax and provide focused expertise for specific domains.

---

## Available Agents

### @orchestrator - Workflow Coordinator

Breaks down complex tasks and delegates to specialized agents. Use for:

- Multi-step features requiring coordination
- Complex workflows spanning multiple components
- Tasks needing systematic validation
- Projects requiring planning and execution phases

**Example Usage:**

```
@orchestrator Add a new authentication system with JWT tokens,
including backend API, frontend integration, and tests
```

**Capabilities:**

- Creates structured task breakdowns
- Delegates to specialized agents
- Coordinates between components
- Validates integration
- Progress tracking with todos

---

### @general - General Purpose

Default agent with access to all tools. Use for:

- Code implementation
- Research and code search
- File operations
- Tool usage
- Standard development tasks

**Example Usage:**

```
@general Search for authentication handlers in the codebase
@general Implement a new tool for JSON formatting
```

---

### @plan - Read-Only Planning

Planning and analysis without making changes. Use for:

- Architecture design
- Implementation planning
- Code review and analysis
- Requirements breakdown

**Example Usage:**

```
@plan Design an architecture for real-time notifications
@plan Analyze the session management system
```

---

## Agent Guidelines

### When to Use @orchestrator

**Use orchestrator for:**

- ✅ Multi-component features (backend + frontend)
- ✅ Complex workflows (research → plan → implement → test)
- ✅ Tasks requiring coordination between multiple agents
- ✅ Features needing systematic validation
- ✅ Large projects with many steps

**Don't use orchestrator for:**

- ❌ Simple, single-file changes
- ❌ Quick bug fixes
- ❌ Straightforward implementations
- ❌ Single-step tasks

### Agent Interaction

Agents can delegate to other agents:

```
@orchestrator → @plan → design
          ↓
        @general → implement
          ↓
        @general → test
```

---

## Build/Test Commands

- **Install**: `bun install`
- **Run**: `bun run index.ts`
- **Typecheck**: `bun run typecheck` (npm run typecheck)
- **Test**: `bun test` (runs all tests)
- **Single test**: `bun test test/tool/tool.test.ts` (specific test file)

## Code Style

- **Runtime**: Bun with TypeScript ESM modules
- **Imports**: Use relative imports for local modules, named imports preferred
- **Types**: Zod schemas for validation, TypeScript interfaces for structure
- **Naming**: camelCase for variables/functions, PascalCase for classes/namespaces
- **Error handling**: Use Result patterns, avoid throwing exceptions in tools
- **File structure**: Namespace-based organization (e.g., `Tool.define()`, `Session.create()`)

## Architecture

- **Tools**: Implement `Tool.Info` interface with `execute()` method
- **Context**: Pass `sessionID` in tool context, use `App.provide()` for DI
- **Validation**: All inputs validated with Zod schemas
- **Logging**: Use `Log.create({ service: "name" })` pattern
- **Storage**: Use `Storage` namespace for persistence
- **API Client**: Go TUI communicates with TypeScript server via stainless SDK. When adding/modifying server endpoints in `packages/opencode/src/server/server.ts`, ask the user to generate a new client SDK to proceed with client-side changes.
