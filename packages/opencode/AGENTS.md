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

## Critical Lessons: Z-Index and Stacking Context (Nov 4, 2025)

### Problem
Widgets rendering above HAL lens despite lens having CSS z-index values set. Visual stacking was backwards.

### Root Cause
**Z-index on child elements is useless if parent container doesn't establish stacking context.**

Structure was:
```jsx
<>
  <div style={{zIndex: 1}}>Widget Grid</div>
  <div style={{zIndex: 40-50}}>Widgets</div>
  <div className="chat-indicator"> {/* NO Z-INDEX! */}
    <div className="status-container"> {/* z-index in CSS */}
      HAL Lens
    </div>
  </div>
</>
```

Widgets had inline z-index as direct children of fragment. Lens nested inside `.chat-indicator` which had **no z-index**, so it wasn't in a stacking context.

### Solution
1. Add `z-index: 100000` to `.chat-indicator` parent container
2. Add `pointer-events: none` to `.chat-indicator` (full-screen, blocks clicks)
3. Add `pointer-events: auto` to `.status-container` (re-enable for lens)
4. Camera feed gets `zIndex: 100001` to be above lens

### Critical Debugging Pattern
**When z-index doesn't work:**
1. Check parent element has z-index set
2. Check parent has `position: relative/absolute/fixed` 
3. Verify entire parent chain establishes stacking context
4. Look at DOM siblings vs nested elements
5. Use: `grep -n "zIndex\|z-index" *.tsx *.css` to see all at once

### Key Rule
**Parent must establish stacking context for child z-index to matter**
- Parent needs: `position` + `z-index`
- Inline styles work, but parent MUST have z-index too
- Full-screen high z-index containers need `pointer-events: none`

