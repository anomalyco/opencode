# Research & Technical Decisions: MCP Connectors Management

**Feature**: 004-mcp-connectors
**Date**: 2026-01-15
**Status**: Complete

## Overview

This document captures research findings and technical decisions for implementing the MCP Connectors management feature in the desktop app.

---

## Decision 1: File Format & Schema

**Decision**: Use JSON with explicit schema validation for `.mcp.json`

**Rationale**:
- MCP (Model Context Protocol) is an emerging standard for AI integrations
- JSON is the standard format for MCP server configurations across the ecosystem
- Schema provided in user requirements shows clear structure: `inputs` array + `servers` object
- JSON allows for comments in development (via JSONC parsers) but strict validation in production

**Alternatives Considered**:
- **YAML**: More human-readable but not the MCP standard
- **TOML**: Simpler syntax but not widely adopted for MCP
- **JSON5**: Allows comments but adds parser complexity

**Schema Structure**:
```typescript
interface McpConfig {
  inputs?: Array<{ type: string; [key: string]: any }>;
  servers: {
    [serverName: string]: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
}
```

**Default Empty Structure**:
```json
{
  "inputs": [],
  "servers": {}
}
```

---

## Decision 2: File I/O Strategy

**Decision**: Use existing SDK client (`sdk.client.file.read()`, `sdk.client.file.write()`) for all file operations

**Rationale**:
- Existing codebase already uses this pattern (see `local.tsx`, `file-activity.tsx`)
- SDK client handles Tauri-specific file system permissions
- Provides consistent error handling across the app
- Supports both workspace-relative paths and absolute paths
- Already tested and proven in production

**Implementation Pattern** (from existing code):
```typescript
const sdk = useSDK()
const mcpJsonPath = ".mcp.json"

// Read
const content = await sdk.client.file.read({ path: mcpJsonPath })
const config = JSON.parse(content)

// Write
await sdk.client.file.write({
  path: mcpJsonPath,
  content: JSON.stringify(config, null, 2)
})
```

**Alternatives Considered**:
- **Direct Tauri fs plugin**: Lower-level but requires manual permission handling
- **Browser File API**: Not available in Tauri context
- **In-memory only**: Would lose data on app restart (rejected)

---

## Decision 3: State Management Pattern

**Decision**: Create dedicated `McpConnectorsContext` using existing `createSimpleContext` pattern

**Rationale**:
- Matches existing architecture (see `FileActivityContext`, `LayoutContext`)
- Provides reactive state updates using Solid.js primitives
- Enables component decoupling and testability
- Centralized state prevents prop drilling

**Context API Structure**:
```typescript
export const {
  use: useMcpConnectors,
  provider: McpConnectorsProvider
} = createSimpleContext({
  name: "McpConnectors",
  init: () => {
    const [config, setConfig] = createStore<McpConfig>({ servers: {} })

    return {
      config: () => config,
      addServer: (name, server) => { /* ... */ },
      updateServer: (name, server) => { /* ... */ },
      removeServer: (name) => { /* ... */ },
      reload: async () => { /* read from file */ },
      save: async () => { /* write to file */ }
    }
  }
})
```

**Alternatives Considered**:
- **Global Solid.js store**: Less encapsulated, harder to test
- **Component-local state**: Harder to share across components
- **Redux/Zustand**: Adds dependency, overkill for this feature

---

## Decision 4: UI Layout Integration

**Decision**: Add connectors panel to centralized `LayoutContext` following `filePreview` pattern

**Rationale**:
- Existing pattern for managing panel state (see `layout.tsx`)
- Provides persistence via `@tauri-apps/plugin-store`
- Enables toggle/resize functionality out of the box
- Maintains UI state across app restarts

**Layout Store Addition**:
```typescript
// In layout.tsx
const layoutStore = createStore({
  // ... existing properties ...
  connectors: {
    opened: true,          // Default visible
    collapsed: false       // Default expanded
  }
})

// Methods
setConnectorsOpened(opened: boolean)
toggleConnectors()
```

**Persistence**: Automatically saved to Tauri store using existing `persisted()` utility

**Alternatives Considered**:
- **Session-only state**: Would lose panel state on restart (rejected)
- **Separate persistence layer**: Adds complexity, inconsistent with existing patterns
- **URL query params**: Not suitable for UI state in desktop app

---

## Decision 5: Component Architecture

**Decision**: Three-component structure following `FileActivitySection` pattern

**Components**:

1. **McpConnectorsSection** (`mcp-connectors-section.tsx`)
   - Top-level container component
   - Uses `Collapsible` from `@kobalte/core`
   - Manages list view + add/edit/remove actions
   - ~200 LOC

2. **McpConnectorItem** (`mcp-connector-item.tsx`)
   - Individual connector list item
   - Displays name, command, args summary
   - Edit/Remove action buttons
   - ~80 LOC

3. **McpConnectorForm** (`mcp-connector-form.tsx`)
   - Dialog-based form for add/edit
   - Uses `Dialog` from `@kobalte/core`
   - Fields: name, command, args array, env object
   - Validation + error handling
   - ~150 LOC

**Rationale**:
- Clear separation of concerns
- Reusable form component for both add and edit
- Testable in isolation
- Follows existing component patterns (see `file-activity-section.tsx`, `file-chip.tsx`)

**Alternatives Considered**:
- **Single monolithic component**: Harder to test and maintain
- **More granular components**: Over-engineering for current scope
- **Inline forms**: Poor UX, no validation separation

---

## Decision 6: Validation Strategy

**Decision**: Multi-layer validation (UI + file save)

**Validation Layers**:

1. **UI Validation** (form level):
   - Required fields: server name, command
   - Server name uniqueness check
   - No empty values in args array
   - Valid JSON for manual JSON input mode

2. **File Save Validation** (before write):
   - Full schema validation using Zod or similar
   - JSON stringify/parse round-trip test
   - File write permission check

**Rationale**:
- Prevents user errors early (better UX)
- Prevents file corruption (data integrity)
- Existing pattern from other file operations in codebase

**Error Handling**:
- UI errors: Show inline validation messages
- File errors: Show toast notification with retry option

**Alternatives Considered**:
- **UI-only validation**: Risk of file corruption if schema changes
- **File-only validation**: Poor UX, late feedback
- **No validation**: Unacceptable risk

---

## Decision 7: File Watch Strategy

**Decision**: Implement file watcher using Tauri's `fs-watch` plugin for external change detection

**Rationale**:
- FR-016 requires handling concurrent file modifications
- User might edit `.mcp.json` in external editor while app is open
- Need to reload UI when file changes externally
- Tauri provides built-in file system watcher

**Implementation**:
```typescript
import { watch } from '@tauri-apps/plugin-fs'

const unwatch = await watch(
  mcpJsonPath,
  (event) => {
    if (event.type === 'modify') {
      // Reload config from file
      mcpConnectors.reload()
      // Show notification: "MCP config updated externally"
    }
  }
)
```

**Edge Case Handling**:
- Debounce rapid changes (500ms)
- Handle invalid JSON gracefully (show error, don't crash)
- Prompt user if there are unsaved changes + external modification

**Alternatives Considered**:
- **Polling**: Inefficient, battery drain
- **No watching**: Violates FR-016, poor UX
- **Manual refresh button**: Extra user burden

---

## Decision 8: Environment Variable Security

**Decision**: Store environment variables as plain text with visual indicators for sensitive data

**Rationale**:
- MCP config files are typically stored in workspace root (user-controlled)
- Encryption would require key management (complex, out of scope)
- Industry standard (see VS Code settings, npm config) is plain text with warnings
- User education better than false security

**Security Measures**:
- Visual indicator (🔒 icon) next to env vars that look like secrets (contain "KEY", "TOKEN", "SECRET")
- Warning message when adding env vars: "Environment variables are stored in plain text"
- Documentation: Recommend using environment variable references instead of hardcoding

**Future Enhancement**:
- Support for env var references: `"SERPER_API_KEY": "${env:SERPER_KEY}"`

**Alternatives Considered**:
- **Encrypted storage**: Adds key management complexity
- **OS keychain integration**: Platform-specific, breaks config portability
- **Omit env vars entirely**: Not feasible, required by MCP servers

---

## Decision 9: Initial Load Strategy

**Decision**: Load `.mcp.json` on workspace mount, create if missing

**Rationale**:
- FR-003 requires automatic initialization
- Loading on mount ensures data is ready when user opens connectors panel
- Lazy loading would add complexity and delay

**Load Flow**:
```typescript
onMount(async () => {
  try {
    const content = await sdk.client.file.read({ path: ".mcp.json" })
    setConfig(JSON.parse(content))
  } catch (error) {
    if (error.code === "FILE_NOT_FOUND") {
      // Create default config
      const defaultConfig = { inputs: [], servers: {} }
      await sdk.client.file.write({
        path: ".mcp.json",
        content: JSON.stringify(defaultConfig, null, 2)
      })
      setConfig(defaultConfig)
    } else {
      // Show error notification
      console.error("Failed to load .mcp.json", error)
    }
  }
})
```

**Alternatives Considered**:
- **Lazy load on panel open**: Delays UX, adds complexity
- **Load on every file change**: Inefficient, handled by file watcher
- **No auto-creation**: Violates FR-003

---

## Decision 10: Inputs Section Management

**Decision**: Provide simple inputs editor in advanced settings section (P4 priority)

**Rationale**:
- User Story 5 is P4 (lowest priority)
- Most users won't modify inputs (default `promptString` is sufficient)
- Can defer to manual JSON editing for now
- Focus implementation effort on P1-P3 stories

**MVP Approach**:
- Display inputs array as read-only JSON
- Provide "Edit in JSON" button that shows raw JSON editor
- Validate JSON on save

**Future Enhancement** (post-MVP):
- Dedicated inputs editor with type selector
- Form-based input configuration

**Alternatives Considered**:
- **Full inputs editor upfront**: Over-engineering for P4 feature
- **No inputs support**: Violates FR-013 (but minimal viable implementation acceptable)

---

## Best Practices Summary

### Solid.js Reactive Patterns

1. **Use `createStore` for complex nested state**:
   ```typescript
   const [config, setConfig] = createStore<McpConfig>({ servers: {} })
   ```

2. **Use `createSignal` for simple values**:
   ```typescript
   const [isEditing, setIsEditing] = createSignal(false)
   ```

3. **Use `createEffect` for side effects**:
   ```typescript
   createEffect(() => {
     // Auto-save when config changes
     if (config.servers) {
       debouncedSave()
     }
   })
   ```

4. **Avoid `any` types** - use explicit TypeScript interfaces

### File Operations Best Practices

1. **Always use try-catch** for file I/O
2. **Validate before write** to prevent corruption
3. **Use descriptive error messages** for user-facing errors
4. **Debounce writes** to prevent excessive disk I/O

### Component Design Best Practices

1. **Keep components under 250 LOC** - split if larger
2. **Use @kobalte components** for accessibility
3. **Follow Tailwind utility-first** styling
4. **Prefer composition over props** for flexibility

### Testing Best Practices

1. **Unit test business logic** (validation, transformations)
2. **Integration test file operations** (read, write, watch)
3. **Mock file system** in tests using SDK mock
4. **Test edge cases** (invalid JSON, missing files, permission errors)

---

## Open Questions (Resolved)

### Q1: Should we support JSON comments in `.mcp.json`?
**Resolution**: No - use strict JSON. MCP standard doesn't specify JSONC. Simplifies parsing.

### Q2: Should we support multiple `.mcp.json` files (per-folder)?
**Resolution**: No - one `.mcp.json` per workspace root. Matches industry standard (package.json, tsconfig.json).

### Q3: Should we validate MCP server configurations by testing connections?
**Resolution**: Out of scope for MVP. File management only. Server validation is a separate feature.

---

## References

- **Existing Code Patterns**:
  - File operations: `packages/app/src/context/local.tsx`
  - Panel layout: `packages/app/src/context/layout.tsx`
  - List sections: `packages/app/src/components/file-activity-section.tsx`
  - Forms: `packages/ui/src/components/dialog.tsx`

- **Dependencies**:
  - Solid.js: https://www.solidjs.com/docs/latest
  - @kobalte/core: https://kobalte.dev/docs/core/overview/introduction
  - Tauri File System: https://v2.tauri.app/plugin/file-system/

- **MCP Protocol**:
  - MCP Specification: https://spec.modelcontextprotocol.io/
  - Configuration format: Based on Claude Desktop app patterns

---

**Research Status**: ✓ Complete
**Next Phase**: Phase 1 - Data Model & Contracts
