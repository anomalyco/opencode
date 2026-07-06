# Desktop package notes

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.

## Cross-platform builds & @lydell/node-pty

The `@lydell/node-pty` package is a virtual meta-package that resolves to a
platform-specific package (`node-pty-linux-x64`, `node-pty-win32-x64`, etc.)
at install time via `optionalDependencies`.

**Critical**: When building the Windows installer from a **Linux** host, you
MUST set `TARGET_PLATFORM=win32 TARGET_ARCH=x64` before running
`electron-vite build`. Without this, the Vite config resolves `@lydell/node-pty`
to `linux-x64`, whose `lib/index.js` lacks `windowsTerminal.js`. On Windows,
`require('./windowsTerminal')` hangs and the entire main module fails to load.

Reference: `electron.vite.config.ts` — `opencode:node-pty-narrower` plugin +
`externalizeDeps: { include: [nodePtyPkg] }`.

Build command for Windows from Linux:
```
TARGET_PLATFORM=win32 TARGET_ARCH=x64 npx electron-vite build
npx electron-builder --win
```
