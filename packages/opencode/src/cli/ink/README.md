# Ink TUI Components

React-based terminal UI components using [Ink](https://github.com/vadimdemedes/ink).

## Architecture

- Components use React 19 with `/** @jsxImportSource react */` pragma
- SolidJS preload excludes `cli/ink/` and `test/cli/ink/` directories
- State managed via useReducer pattern

## Running

```bash
# Run Ink test file
bun --no-plugins src/cli/ink/test.tsx

# Run tests
bun test test/cli/ink/
```

## Known Issues

### React Hook Warnings in Tests

Tests show "Invalid hook call" warnings due to ink-testing-library@4.0.0 not fully supporting React 19.2.4. These warnings are **cosmetic only**:

- ✅ All test assertions pass
- ✅ Runtime works correctly
- ✅ No functional impact

The warnings will resolve when ink-testing-library releases React 19 support.

## Components

- `App` - Root application component
- `MessageList` - Static message history
- `StreamingProse` - Live text with cursor
- `InputLine` - Text input
- `SelectMenu` - Option selector
- `StatusBar` - Agent/model/status display
- `ToolDisplay` - Tool execution status
- `TaskDisplay` - Subagent task status
