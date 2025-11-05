# Sidebar Tabs Plugin

Complete implementation of the sidebar tab system (Tools, Todos, Files) as a plugin.

## Important: No Build Required

This plugin is loaded directly as a `.tsx` file by Bun. Do NOT build it with `bun run build.ts` - Bun's bundler will transform JSX to React style instead of SolidJS.

**In `opencode.json`:**

```json
{
  "plugin": ["file:///path/to/examples/plugin-sidebar-tabs/index.tsx"]
}
```

Bun will automatically transpile the TypeScript/TSX using the `tsconfig.json` settings in the parent directory.

## What it includes:

- Tab navigation UI
- Tools tab (tools used, LSP, MCP, widgets, panels)
- Todos tab
- Files tab (session files with selection)

## Context required:

- sessionID
- session data
- sync data (MCP/LSP)
- todos
- tools used
- active tab state
- file selection state
- theme
- renderer
- all click handlers

This is a complex plugin that replicates the entire tab system functionality.
