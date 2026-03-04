# OPENSACIA Phase 1: Cloud Decoupling Design

**Date:** 2026-03-04
**Author:** Victor Gonzalez (vicorente)
**Status:** Approved
**Related Issue:** N/A

## Overview

This document establishes the design for Phase 1 of OPENSACIA: forking OpenCode and eliminating all cloud dependencies to enable operation in air-gapped environments.

**Repository:** https://github.com/vicorente/OPENSACIA
**Upstream:** https://github.com/anomalyco/opencode

## Architecture

### Project Structure

```
OPENSACIA/
├── packages/
│   ├── app/              # SolidJS + Vite web UI
│   │   └── dist/         # NEW: Production static build
│   ├── opencode/         # CLI/TUI core + Hono server
│   │   └── src/server/
│   │       └── server.ts # MODIFY: Serve local assets
│   └── ui/               # Shared components
└── docs/
    └── plans/
        └── 2026-03-04-opensacia-phase1-design.md
```

### Request Flow

| Current (OpenCode) | OPENSACIA (Phase 1) |
|--------------------|---------------------|
| Browser → Hono Server → proxy(`https://app.opencode.ai`) | Browser → Hono Server → `serveStatic('./packages/app/dist')` |

### Phase 1 Milestones

1. ✅ Fork repository
2. Configure static build for `packages/app`
3. Modify Hono server to serve local assets
4. Eliminate external CDN dependencies
5. Enable 0.0.0.0 binding and mDNS

## Components to Modify

### 2.1 `packages/app/vite.config.ts`

```typescript
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    // NEW: Production-ready static build config
    outDir: "dist",
    emptyOutDir: true,
    minify: "terser",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
```

### 2.2 `packages/opencode/src/server/server.ts` (Lines 561-576)

**Remove:**
```typescript
.all("/*", async (c) => {
  const path = c.req.path
  const response = await proxy(`https://app.opencode.ai${path}`, {
    ...c.req,
    headers: {
      ...c.req.raw.headers,
      host: "app.opencode.ai",
    },
  })
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ..."
  )
  return response
})
```

**Add:**
```typescript
import { serveStatic } from "hono/bun"

// ... at the end of routes
.all("/*", serveStatic({
  root: "../../app/dist",
  onNotFound: (path) => {
    log.debug("static file not found", { path })
  }
}))
```

### 2.3 Network Configuration

The server already supports 0.0.0.0 and mDNS (lines 594-640). Only requires configuration via flags.

## Data Flow & Build Process

### Build Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    BUILD PROCESS                            │
└─────────────────────────────────────────────────────────────┘

1. Development (dev):
   bun run dev:web  → vite dev server (localhost:3000)

2. Production Build:
   bun run --cwd packages/app build
                        ↓
   Generates: packages/app/dist/
               ├── index.html
               ├── assets/
               │   ├── index-[hash].js
               │   └── index-[hash].css
               └── favicon-*

3. Server Execution:
   bun run packages/opencode/src/index.ts
                        ↓
   Hono server on port 4096
   Serves: / → packages/app/dist/index.html
           /assets/* → packages/app/dist/assets/*
```

### Asset Resolution

```
Request: http://localhost:4096/
  ↓
Hono Router
  ↓
FileRoutes()    → /project, /pty, /config, etc.
StaticFallback → serveStatic("../../app/dist")
  ↓
index.html → assets/index-abc123.js → SPA executes
  ↓
API calls → /session, /provider, etc. → Hono Backend
```

### External Dependencies Removal

| Resource | Current Source | OPENSACIA Solution |
|----------|----------------|-------------------|
| JS/CSS Bundle | `app.opencode.ai` | Local Vite build |
| Favicon | Symlinks to `ui/src/assets/` | Copied to `dist/` by Vite |
| Fonts | CDN (Google Fonts) | Remove or inline |
| WASM modules | External | Included in Vite build |

## Error Handling & Edge Cases

### Scenarios

| Scenario | Current | OPENSACIA |
|----------|---------|-----------|
| Static file not found | Proxy 404 from `app.opencode.ai` | Return 404 with debug log |
| Build not run | Proxy works (online) | Startup error + clear message |
| MIME types incorrect | Handled by external server | Configure `serveStatic` with `mimes` |
| No network (dev) | UI load fails | Works completely |
| SPA router refresh | Handled by external server | Fallback to `index.html` |

### Startup Validation

```typescript
// NEW: Validate build exists before starting server
import { existsSync } from "fs"

const STATIC_DIST_PATH = "./packages/app/dist"

export function listen(opts: { ... }) {
  if (!existsSync(STATIC_DIST_PATH)) {
    throw new Error(
      `Static build not found at ${STATIC_DIST_PATH}.\n` +
      `Run: bun run --cwd packages/app build`
    )
  }
  // ... rest of listen()
}
```

### Security Headers

```typescript
response.headers.set(
  "Content-Security-Policy",
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' data: ws://localhost:* ws://127.0.0.1:*;"
)
```

## Testing & Validation

### Unit Tests

```bash
# Existing OpenCode tests
bun run --cwd packages/app test:unit

# Verify build doesn't break components
bun run --cwd packages/app build
bun run --cwd packages/app serve  # vite preview
```

### Integration Tests (Offline)

```bash
# Simulate air-gapped environment
1. Disconnect network
2. bun run --cwd packages/app build
3. bun run packages/opencode/src/index.ts
4. Open http://localhost:4096
5. Verify:
   ✓ UI loads completely
   ✓ Assets load (favicon, CSS, JS)
   ✓ API calls work
   ✓ No external connection attempts
```

### Validation Checklist - Phase 1

| Item | Command | Expected |
|------|---------|----------|
| Fork completed | `git remote -v` | `upstream → anomalyco/opencode` |
| Static build | `bun run --cwd packages/app build` | `dist/` created without errors |
| No web dependencies | Network inspection | 0 requests to `*.opencode.ai` |
| Local server | `bun run dev` | Server listening on `0.0.0.0:4096` |
| Authentication | `OPENSACIA_SERVER_PASSWORD=x` | Basic auth functional |
| mDNS | Flag `--mdns` | `opensacia.local` resolves |

### Air-Gapped Final Test

```bash
# Environment
env -i HOME="$HOME" bun run packages/opencode/src/index.ts --mdns

# Expected:
# - Server starts without errors
# - UI accessible at http://opensacia.local:4096
# - Full functionality without Internet
```

## Rebranding Changes

| File | Change |
|------|--------|
| `packages/app/index.html` | `<title>OPENSACIA</title>` |
| `packages/opencode/src/server/server.ts` | `username: Flag.OPENSACIA_SERVER_USERNAME ?? "opensacia"` |
| Environment variables | `OPENCODE_*` → `OPENSACIA_*` |
| mDNS domain | `opencode.local` → `opensacia.local` |

## Next Steps

After this design is implemented:

1. **Phase 2:** Integrate local inference (Ollama)
2. **Phase 3:** Migrate from GitHub to GitLab
3. **Phase 4:** Security auditor specialization
4. **Phase 5:** CI/CD orchestration
5. **Phase 6:** Testing and deployment

## References

- Original Plan: Fase 1 - Desacoplamiento de la Nube y Modo Offline
- OpenCode Repository: https://github.com/anomalyco/opencode
- Vite Documentation: https://vitejs.dev/
- Hono Documentation: https://hono.dev/
