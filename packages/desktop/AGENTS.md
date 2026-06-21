# LOGGING
- **FORBIDDEN**: NEVER print javascript object in console, print **strings** with what you need to debug

# Desktop package notes

## Architecture

This is an Electron-only desktop app (Tauri has been removed).

- **Main process**: `src/main/` — Electron main process, sidecar management, IPC handlers
- **Preload**: `src/preload/` — Electron preload bridge
- **Renderer**: `src/renderer/` — SolidJS renderer (electron-vite)

## 🚀 Build

```bash
# Dev mode
bun run --cwd packages/desktop dev

# Production build
bun run --cwd packages/desktop build

# Package
bun run --cwd packages/desktop package:mac   # macOS
bun run --cwd packages/desktop package:win   # Windows
bun run --cwd packages/desktop package:linux # Linux
```

## 📦 Build artifacts

| Type         | Path                                        |
| ------------ | ------------------------------------------- |
| **App**      | `packages/desktop/out/`                     |
| **Package**  | `packages/desktop/dist/`                    |

## ✅ Verify

```bash
# Typecheck
bun run --cwd packages/desktop typecheck

# Tests (must run from package dir, not project root)
cd packages/desktop && bun test
```

---

_Last updated: 2026-06-21_
