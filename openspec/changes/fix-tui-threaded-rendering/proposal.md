# Change: Enable Threaded Rendering to Fix TUI Freezing

## Why

The TUI freezes for 6+ seconds during normal typing, making the application unusable during these periods. Users experience complete input lag where keystrokes are not registered until the freeze ends.

**Root Cause**: The @opentui native library makes FFI (Foreign Function Interface) calls to render the terminal UI. In Bun, FFI calls are synchronous and block the JavaScript event loop. The native rendering operations were taking ~6.5 seconds and occurring every ~5 seconds, causing periodic complete freezes.

**Diagnosis Method**: Created a heartbeat-based diagnostic that detected event loop blocks by measuring gaps between expected 100ms intervals. The diagnostic confirmed consistent ~6.5 second blocks.

## What Changes

- Enable `useThread: true` in the @opentui render configuration
- This moves native FFI rendering calls to a separate thread, preventing them from blocking the JS event loop

**Code Change** (1 line):
```typescript
// packages/opencode/src/cli/cmd/tui/app.tsx
render(component, {
  targetFps: 60,
  gatherStats: false,
  exitOnCtrlC: false,
  useThread: true, // Enable threaded rendering to avoid blocking the JS event loop
  useKittyKeyboard: {},
  // ...
})
```

## Impact

- **Affected specs**: None (bug fix restoring expected behavior - TUI should not freeze)
- **Affected code**: `packages/opencode/src/cli/cmd/tui/app.tsx:152`
- **Risk**: Low - the `useThread` option is a supported @opentui feature
- **Testing**: Verified with perf diagnostics showing zero `[BLOCKED]` messages after fix
