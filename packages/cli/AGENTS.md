# V2 CLI and TUI development guide

## Migration context

- The TUI is being ported from legacy APIs to the new V2 APIs. New and migrated TUI behavior should use `sdk.client.v2` and the location-scoped data in `packages/tui/src/context/data.tsx` instead of adding dependencies on legacy sync state.
- Preserve established TUI behavior unless the task intentionally changes it.
- Load the `opencode-dev` skill before interactively running, debugging, or verifying opencode's V2 CLI, TUI, or server.
