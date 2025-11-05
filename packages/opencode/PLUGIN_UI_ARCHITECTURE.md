# Plugin UI Architecture

## Overview

The sidebar has been re-architected to use a **plugin-based UI system**. The core sidebar is now minimal (145 lines vs 890 lines), and all UI components are implemented as plugins.

## Architecture

### Core Components

1. **Minimal Sidebar** (`src/cli/cmd/tui/routes/session/sidebar.tsx`)
   - Only 145 lines
   - Renders plugin widgets and panels based on positioning
   - Provides context to plugins (session, tokens, tools, todos, files)
   - No business logic - just plugin rendering

2. **Plugin UI System** (`src/ui/`)
   - `types.ts` - TypeScript interfaces for UI components
   - `schema.ts` - Zod schemas for validation
   - `registry.ts` - Plugin discovery and rendering

### Plugin Positioning

Widgets and panels can specify their position in the sidebar:

- **Widgets**: `sidebarPosition: "top" | "bottom" | "inline"`
- **Panels**: `position: "top" | "bottom"`

This allows plugins to control where they appear in the sidebar layout.

## Plugins

### 1. Sidebar UI Plugin (`examples/plugin-sidebar-ui/`)

**Purpose**: Core sidebar functionality

**Components**:

- `server-status` widget (top) - Shows server connection status
- `context-bar` widget (top) - Shows token usage, percentage, cost
- `main-tabs` panel (bottom) - Tabbed interface with Tools/Todos/Files

**Replaces**: All the original sidebar logic for tools, todos, and files

### 2. Demo Tabs Plugin (`examples/plugin-demo-tabs/`)

**Purpose**: Demonstrates plugin tab capabilities

**Components**:

- `demo-tabs` panel (bottom) - Three demo tabs showing plugin features
  - Demo 1: Counter and session info
  - Demo 2: Session details
  - Demo 3: Plugin capabilities list

**Demonstrates**:

- Creating custom tabbed interfaces
- State management in plugins
- Dynamic content rendering
- Tab switching via actions

## Configuration

Plugins are loaded via `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///path/to/plugin-sidebar-ui/index.ts",
    "file:///path/to/plugin-demo-tabs/index.ts"
  ]
}
```

## Plugin Context

Plugins receive rich context about the session:

```typescript
{
  sessionID: string
  serverUrl: string
  serverStatus: "connected" | "disconnected"
  tokens: number
  tokenLimit: number
  percentage: number
  cost: string
  toolsUsed: Array<[string, number]>
  todos: Array<{ status: string; content: string }>
  files: Array<{ file: string; additions: number; deletions: number }>
}
```

## Benefits

1. **Clean Core**: Sidebar is now minimal and maintainable
2. **Extensible**: New UI components via plugins without touching core
3. **Isolated**: Each plugin manages its own state and logic
4. **Reusable**: Plugins can be shared across projects
5. **Testable**: Plugins can be tested independently
6. **Demo-Ready**: Demo tabs show off plugin capabilities

## Migration Path

The old sidebar is backed up at `sidebar-old.tsx` for reference. All functionality has been moved to plugins, making the system more modular and extensible.

## Next Steps

1. Add tab switching interactions (click to switch tabs)
2. Add more actions for demo tabs (increment counter, etc.)
3. Create plugin marketplace/registry
4. Add hot-reloading for plugin development
5. Document plugin API for third-party developers
