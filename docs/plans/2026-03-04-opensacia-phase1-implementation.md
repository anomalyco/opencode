# OPENSACIA Phase 1: Cloud Decoupling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminar todas las dependencias de infraestructura web externa de OpenCode para operar en entornos air-gapped, sirviendo la UI web desde assets estáticos locales.

**Architecture:** Reemplazar el proxy a `app.opencode.ai` en el servidor Hono por `serveStatic` de Hono/Bun, configurando un build estático production-ready de la app SolidJS/Vite. Validar que no existan llamadas externas al iniciar el servidor.

**Tech Stack:** Bun, Vite, SolidJS, Hono, TypeScript

---

## Task 1: Verify Fork and Upstream Configuration

**Files:**
- Verify: `.git/config`

**Step 1: Check git remote configuration**

Run: `git remote -v`

Expected output should include:
```
upstream    https://github.com/anomalyco/opencode (fetch)
upstream    https://github.com/anomalyco/opencode (push)
origin      https://github.com/vicorente/OPENSACIA (fetch)
origin      https://github.com/vicorente/OPENSACIA (push)
```

**Step 2: If upstream is missing, add it**

Run: `git remote add upstream https://github.com/anomalyco/opencode`

**Step 3: Verify current branch**

Run: `git branch --show-current`

Expected: `dev` or `main`

**Step 4: Create feature branch for Phase 1**

Run: `git checkout -b feature/phase1-cloud-decoupling`

---

## Task 2: Configure Production Build for packages/app

**Files:**
- Modify: `packages/app/vite.config.ts`

**Step 1: Read current vite.config.ts**

Read: `packages/app/vite.config.ts`

Current content:
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
    // sourcemap: true,
  },
})
```

**Step 2: Update build configuration**

Replace entire content of `packages/app/vite.config.ts` with:
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
    // OPENSACIA: Production-ready static build config
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

**Step 3: Test build command**

Run: `bun run --cwd packages/app build`

Expected: Build completes successfully with `dist/` directory created.

**Step 4: Verify build output**

Run: `ls -la packages/app/dist/`

Expected output should include:
```
index.html
assets/
```

**Step 5: Commit**

```bash
git add packages/app/vite.config.ts
git commit -m "feat(app): configure production build for static assets"
```

---

## Task 3: Rebrand HTML Title

**Files:**
- Modify: `packages/app/index.html`

**Step 1: Read current index.html**

Read: `packages/app/index.html`

Find line 6: `<title>OpenCode</title>`

**Step 2: Update title**

Replace `<title>OpenCode</title>` with `<title>OPENSACIA</title>`

**Step 3: Verify change**

Run: `grep "OPENSACIA" packages/app/index.html`

Expected: `<title>OPENSACIA</title>`

**Step 4: Commit**

```bash
git add packages/app/index.html
git commit -m "feat(app): rebrand title to OPENSACIA"
```

---

## Task 4: Modify Hono Server to Serve Local Assets

**Files:**
- Modify: `packages/opencode/src/server/server.ts`

**Step 1: Read server.ts to locate proxy section**

Read: `packages/opencode/src/server/server.ts`

Locate lines 561-576 containing the `.all("/*", async (c) => { ... })` handler with `proxy`.

**Step 2: Add serveStatic import**

Add import at line 9 (after `import { proxy } from "hono/proxy"`):

```typescript
import { serveStatic } from "hono/bun"
```

**Step 3: Replace proxy handler with static file serving**

Locate the `.all("/*", async (c) => { ... })` handler (lines 561-576) and replace with:

```typescript
.all("/*", serveStatic({
  root: "../../app/dist",
  onNotFound: (path) => {
    log.debug("static file not found", { path })
  }
}))
```

**Note:** Remove the `as unknown as Hono` type assertion at the end.

**Step 4: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors.

**Step 5: Commit**

```bash
git add packages/opencode/src/server/server.ts
git commit -m "feat(server): replace cloud proxy with local static assets"
```

---

## Task 5: Add Startup Validation for Static Build

**Files:**
- Modify: `packages/opencode/src/server/server.ts`

**Step 1: Add fs import**

Add at top of file (around line 3 with other imports):

```typescript
import { existsSync } from "node:fs"
```

**Step 2: Add constant for dist path**

Add after line 52 (after `let _corsWhitelist: string[] = []`):

```typescript
const STATIC_DIST_PATH = "./packages/app/dist"
```

**Step 3: Add validation in listen function**

Locate the `export function listen(opts: { ... })` function (around line 594).

Add validation at the beginning of the function (after line 600 `_corsWhitelist = opts.cors ?? []`):

```typescript
// OPENSACIA: Validate static build exists
if (!existsSync(STATIC_DIST_PATH)) {
  throw new Error(
    `Static build not found at ${STATIC_DIST_PATH}.\n` +
    `Run: bun run --cwd packages/app build`
  )
}
```

**Step 4: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors.

**Step 5: Commit**

```bash
git add packages/opencode/src/server/server.ts
git commit -m "feat(server): add startup validation for static build"
```

---

## Task 6: Update Environment Variable Names for Rebranding

**Files:**
- Modify: `packages/opencode/src/flag/flag.ts`

**Step 1: Locate flag definitions**

Find file with environment variable flags.

Run: `grep -r "OPENCODE_SERVER" packages/opencode/src/`

Expected: Found in `packages/opencode/src/flag/flag.ts`

**Step 2: Read flag.ts**

Read: `packages/opencode/src/flag/flag.ts`

Locate `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` definitions.

**Step 3: Add OPENSACIA aliases**

Add new flags that support both OPENCODE_ (for compatibility) and OPENSACIA_ (new):

Find the flag definitions and add aliases. The exact implementation depends on the current code structure.

Typically add:
```typescript
export const OPENSACIA_SERVER_USERNAME =
  Flags.string("OPENSACIA_SERVER_USERNAME") ??
  Flags.string("OPENCODE_SERVER_USERNAME")

export const OPENSACIA_SERVER_PASSWORD =
  Flags.string("OPENSACIA_SERVER_PASSWORD") ??
  Flags.string("OPENCODE_SERVER_PASSWORD")
```

**Step 4: Update server.ts to use new flags**

In `packages/opencode/src/server/server.ts` (around line 86-88):

Change:
```typescript
const password = Flag.OPENCODE_SERVER_PASSWORD
if (!password) return next()
const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
```

To:
```typescript
const password = Flag.OPENSACIA_SERVER_PASSWORD
if (!password) return next()
const username = Flag.OPENSACIA_SERVER_USERNAME ?? "opensacia"
```

**Step 5: Verify syntax**

Run: `bun run --cwd packages/opencode typecheck`

Expected: No type errors.

**Step 6: Commit**

```bash
git add packages/opencode/src/flag/flag.ts packages/opencode/src/server/server.ts
git commit -m "feat(rebrand): add OPENSACIA environment variable aliases"
```

---

## Task 7: Update mDNS Domain

**Files:**
- Modify: `packages/opencode/src/server/mdns.ts`

**Step 1: Locate mDNS configuration**

Run: `grep -r "opencode.local" packages/opencode/src/`

**Step 2: Read mdns.ts**

Read: `packages/opencode/src/server/mdns.ts`

**Step 3: Update default domain**

Change any default `"opencode"` references to `"opensacia"`.

**Step 4: Commit**

```bash
git add packages/opencode/src/server/mdns.ts
git commit -m "feat(rebrand): update mDNS domain to opensacia.local"
```

---

## Task 8: Build and Test Locally

**Step 1: Build the app**

Run: `bun run --cwd packages/app build`

Expected: Build completes, `packages/app/dist/` exists.

**Step 2: Start the server**

Run: `bun run packages/opencode/src/index.ts`

Expected: Server starts without errors, listening on port 4096.

**Step 3: Test web UI access**

Open browser: `http://localhost:4096`

Expected:
- OPENSACIA title in browser tab
- UI loads completely
- No console errors about missing assets
- No network requests to `*.opencode.ai`

**Step 4: Test with authentication**

Stop server (Ctrl+C).

Run with password:
```bash
OPENSACIA_SERVER_PASSWORD=test123 bun run packages/opencode/src/index.ts
```

Open browser: `http://localhost:4096`

Expected: Browser prompts for username/password.
Enter: `opensacia` / `test123`

Expected: UI loads after authentication.

**Step 5: Test mDNS (optional, if supported)**

Run:
```bash
bun run packages/opencode/src/index.ts --mdns --hostname 0.0.0.0
```

Expected: Service advertised as `opensacia.local`.

---

## Task 9: Air-Gapped Validation Test

**Step 1: Disconnect from network (simulate air-gapped)**

Option A: Disconnect network cable
Option B: Disable network adapter
Option C: Use firewall to block external connections

**Step 2: Start server**

Run: `bun run packages/opencode/src/index.ts`

Expected: Server starts without errors.

**Step 3: Test UI**

Open: `http://localhost:4096`

Expected: Full functionality without network.

**Step 4: Verify no external connections**

Open browser DevTools → Network tab

Expected:
- No requests to `*.opencode.ai`
- No requests to CDNs
- All assets served from `localhost:4096`

**Step 5: Test API functionality**

Try using the application (open files, run commands, etc.)

Expected: All features work offline.

**Step 6: Reconnect network**

---

## Task 10: Create Documentation and README

**Files:**
- Create: `docs/phase1-setup.md`

**Step 1: Create setup documentation**

Create `docs/phase1-setup.md`:

```markdown
# OPENSACIA Phase 1: Setup and Running

## Building for Production

```bash
# Build the web UI
bun run --cwd packages/app build

# Run the server
bun run packages/opencode/src/index.ts
```

## Air-Gapped Operation

Once built, OPENSACIA operates completely offline:

1. Build the application (requires internet for dependencies)
2. Transfer the entire `OPENSACIA/` directory to air-gapped system
3. Run: `bun run packages/opencode/src/index.ts`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSACIA_SERVER_PASSWORD` | (none) | Enable basic authentication |
| `OPENSACIA_SERVER_USERNAME` | `opensacia` | Username for basic auth |

### Command Line Options

```bash
# Bind to all interfaces (network access)
bun run packages/opencode/src/index.ts --hostname 0.0.0.0

# Enable mDNS discovery
bun run packages/opencode/src/index.ts --mdns --mdns-domain opensacia.local
```

## Accessing the Web UI

- Local: http://localhost:4096
- Network: http://<server-ip>:4096
- mDNS: http://opensacia.local:4096
```

**Step 2: Commit**

```bash
git add docs/phase1-setup.md
git commit -m "docs: add Phase 1 setup and running guide"
```

---

## Task 11: Final Validation and Push

**Step 1: Run full test suite**

Run: `bun run typecheck`

Expected: No type errors across project.

**Step 2: Verify git status**

Run: `git status`

Expected: All changes committed, no untracked files in working directory.

**Step 3: Push to remote**

Run: `git push origin feature/phase1-cloud-decoupling`

**Step 4: Create pull request (if desired)**

Run:
```bash
gh pr create --title "Phase 1: Cloud Decoupling - Air-Gapped Operation" \
  --body "Implements Phase 1 of OPENSACIA: eliminating cloud dependencies for air-gapped operation."
```

---

## Validation Checklist

Before marking Phase 1 complete, verify:

- [ ] Fork is configured with upstream
- [ ] `packages/app` builds to `dist/` without errors
- [ ] Server serves static assets from `dist/`
- [ ] No proxy calls to `app.opencode.ai`
- [ ] UI loads with "OPENSACIA" title
- [ ] Basic auth works with `OPENSACIA_SERVER_*` variables
- [ ] mDNS advertises `opensacia.local`
- [ ] Application works completely offline (air-gapped test)
- [ ] All tests pass
- [ ] Documentation created

---

## References

- Design Document: `docs/plans/2026-03-04-opensacia-phase1-design.md`
- Original Plan: Fase 1 - Desacoplamiento de la Nube y Modo Offline
- OpenCode Repository: https://github.com/anomalyco/opencode
