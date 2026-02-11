# Claxedo App Architecture

This document provides comprehensive technical documentation for the Claxedo App, a cloud-enabled extension of OpenCode.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Override System](#2-override-system)
3. [Context Overrides](#3-context-overrides)
4. [Custom UI System](#4-custom-ui-system-claxedo-layout)
5. [Extension System](#5-extension-system)
6. [Feature Flags](#6-feature-flags)
7. [Cloud Components](#7-cloud-components)
8. [Desktop Integration](#8-desktop-integration)
9. [Backend Server Integration](#9-backend-server-integration)
10. [Process Control Plane Feature](#10-process-control-plane-feature)

---

## 1. System Overview

### 1.1 Monorepo Structure

```
opencode/
├── packages/
│   ├── app/                    # Upstream OpenCode app (pristine)
│   │   └── src/
│   │       ├── context/        # React-like contexts
│   │       ├── pages/          # Route components
│   │       ├── components/     # Shared UI components
│   │       └── utils/          # Utilities
│   │
│   ├── app-shared/             # Extension system definitions
│   │   └── src/
│   │       └── extension-points.ts
│   │
│   ├── claxedo-app/            # Cloud extension package (this package)
│   │   └── src/
│   │       ├── overrides/      # File overrides
│   │       ├── extensions/     # Extension factories
│   │       ├── claxedo-ui/     # Custom UI components
│   │       ├── agent-hooks/    # Terminal agent lifecycle
│   │       ├── context/        # Claxedo-specific contexts
│   │       ├── components/     # Cloud components
│   │       ├── pages/          # Cloud pages
│   │       └── utils/          # Cloud utilities
│   │
│   ├── desktop/                # Tauri desktop app (upstream)
│   ├── opencode/               # Core server package
│   ├── sdk/                    # Client SDK
│   └── ui/                     # Shared UI primitives
│
└── claxedo/                    # Cloud backend server
```

### 1.2 Claxedo-App Relationship to Upstream

Claxedo-app extends OpenCode through two complementary mechanisms:

1. **File Overrides**: Replace specific upstream files at build time via Vite aliases
2. **Extension System**: Register additional functionality via `app-shared` extension points

This architecture enables:
- **Zero upstream modifications**: `packages/app` remains pristine
- **Daily upstream syncs**: Merges are typically conflict-free
- **Isolated customization**: All Claxedo code lives in `claxedo-app`

---

## 2. Override System

### 2.1 How Vite Aliases Work

The override system uses Vite's `resolve.alias` to intercept module imports at build time.

**Configuration** (`vite.cloud.config.ts`):

```typescript
function overrides() {
  const root = "./src/overrides/"
  const files = listAllFiles(root).filter(f => f.endsWith(".ts") || f.endsWith(".tsx"))

  return files.map(p => {
    const rel = path.relative(root, p)
    const key = `@/${rel.replace(/\.(ts|tsx)$/, "")}`
    return { find: key, replacement: p }
  })
}

export default defineConfig({
  resolve: {
    alias: [
      ...overrides(),                    // Specific overrides (highest priority)
      { find: "@claxedo/", replacement: "./src/" },  // Claxedo imports
      { find: "@/", replacement: "../app/src/" },    // Upstream fallback
    ],
  },
})
```

**Resolution Order**:
1. Check `src/overrides/` for exact match
2. Fall back to `packages/app/src/`

### 2.2 Directory Structure

```
src/overrides/
├── app.tsx                      # Main app entry
├── context/
│   ├── command.tsx              # Command palette context
│   ├── comments.tsx             # Code comments context
│   ├── file.tsx                 # File management context
│   ├── global-sdk.tsx           # Global SDK context
│   ├── global-sync.tsx          # Global sync context
│   ├── highlights.tsx           # Syntax highlighting context
│   ├── language.tsx             # i18n context
│   ├── layout.tsx               # Layout state context
│   ├── local.tsx                # Local storage context
│   ├── models.tsx               # AI models context
│   ├── notification.tsx         # Notifications context
│   ├── permission.tsx           # Permissions context
│   ├── platform.tsx             # Platform detection context
│   ├── prompt.tsx               # Prompt input context
│   ├── sdk.tsx                  # Per-directory SDK context
│   ├── server.tsx               # Server connection context
│   ├── settings.tsx             # Settings context
│   ├── sync.tsx                 # Per-directory sync context
│   └── terminal.tsx             # Terminal management context
├── pages/
│   ├── home.tsx                 # Home page
│   ├── layout.tsx               # Root layout
│   └── directory-layout.tsx     # Per-directory layout
├── components/
│   ├── dialog-settings.tsx      # Settings dialog
│   ├── settings-general.tsx     # General settings
│   ├── status-popover.tsx       # Server status popover
│   └── terminal.tsx             # Terminal component
└── terminal/
    └── ...                      # xterm.js terminal implementation
```

### 2.3 Adding New Overrides

1. Copy the upstream file:
   ```bash
   cp ../app/src/components/example.tsx src/overrides/components/
   ```

2. Make modifications (keep `@/` imports intact)

3. The override is automatically picked up (no config changes needed)

4. Document in this file's [Context Overrides](#3-context-overrides) section

---

## 3. Context Overrides

### 3.1 Overview

Claxedo overrides 20+ context files. Each override enables specific cloud/desktop functionality while maintaining upstream compatibility.

### 3.2 Context Override Reference

| Context | File | Changes | Purpose |
|---------|------|---------|---------|
| `ServerProvider` | `context/server.tsx` | `transformUrl`, workspace-server mapping | URL canonicalization, multi-server support |
| `TerminalProvider` | `context/terminal.tsx` | Server-scoped persistence, session isolation | PTY state per server instance |
| `LayoutProvider` | `context/layout.tsx` | Global orchestration, review diff state | Multi-workspace layout coordination |
| `GlobalSyncProvider` | `context/global-sync.tsx` | `onServerChange` hook | Server switch cleanup |
| `GlobalSDKProvider` | `context/global-sdk.tsx` | Global client + event stream | App-level SDK access |
| `SyncProvider` | `context/sync.tsx` | Per-directory sync state | Workspace data sync |
| `SDKProvider` | `context/sdk.tsx` | Per-directory SDK client | Workspace API access |
| `LanguageProvider` | `context/language.tsx` | Extension strings merge | Cloud i18n strings |
| `PlatformProvider` | `context/platform.tsx` | `webProjectDialog` support | Cloud project creation |
| `LocalProvider` | `context/local.tsx` | Server-scoped storage | Multi-server data isolation |
| `SettingsProvider` | `context/settings.tsx` | Extension settings sections | Cloud settings UI |
| `CommandProvider` | `context/command.tsx` | Command palette extensions | Cloud commands |
| `PromptProvider` | `context/prompt.tsx` | Prompt input extensions | Input handling |
| `FileProvider` | `context/file.tsx` | File management extensions | Cloud file handling |
| `PermissionProvider` | `context/permission.tsx` | Permission handling | Cloud permissions |
| `NotificationProvider` | `context/notification.tsx` | Notification system | Cloud notifications |
| `ModelsProvider` | `context/models.tsx` | AI model management | Model configuration |
| `CommentsProvider` | `context/comments.tsx` | Code comments | Review comments |
| `HighlightsProvider` | `context/highlights.tsx` | Syntax highlighting | Editor highlights |

### 3.3 Context Scope Architecture

Claxedo has two distinct context scopes with different provider availability:

```
┌─────────────────────────────────────────────────────────────┐
│  APP SCOPE (outside SDKProvider)                            │
│                                                             │
│  Available:                                                 │
│  - ServerProvider                                           │
│  - GlobalSDKProvider                                        │
│  - GlobalSyncProvider                                       │
│  - LayoutProvider                                           │
│  - PlatformProvider                                         │
│  - CommandProvider                                          │
│  - LanguageProvider                                         │
│                                                             │
│  Components: ClaxedoLayout, RailLayout, TabBar              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  DIRECTORY SCOPE (inside SDKProvider)               │   │
│  │                                                     │   │
│  │  Additional:                                        │   │
│  │  - SDKProvider (per-directory)                      │   │
│  │  - SyncProvider (per-directory)                     │   │
│  │  - TerminalProvider (per-directory)                 │   │
│  │  - FileProvider (per-directory)                     │   │
│  │                                                     │   │
│  │  Components: Session, Review, Terminal, FileView    │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Key Rules**:
- Never call directory-scope hooks (`useSDK()`, `useSync()`, `useTerminal()`) from app scope
- Use `useGlobalSync().child(directory)` for app-scope access to directory data
- Use Portal pattern to render directory-scope content in app-scope locations

---

## 4. Custom UI System (Claxedo Layout)

### 4.1 Rail Sidebar + Tab-Based Navigation

Claxedo replaces the default OpenCode layout with a rail-based navigation system:

```
┌──────────────────────────────────────────────────────────────┐
│  Top Tab Bar                                          [+] ▼ │
│  ├── Session 1  │  Terminal  │  Review  │                   │
├──────────────────────────────────────────────────────────────┤
│ R │                                                         │
│ A │                                                         │
│ I │                                                         │
│ L │            Tab Content Area                             │
│   │                                                         │
│ S │            (Session / Terminal / Review)                │
│ I │                                                         │
│ D │                                                         │
│ E │                                                         │
│ B │                                                         │
│ A │                                                         │
│ R │                                                         │
├───┼─────────────────────────────────────────────────────────┤
│ ⚙️│  Status Bar                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Component Hierarchy

```
ClaxedoLayout
├── ClaxedoLayoutProvider (state management)
│   └── ClaxedoStateBridge (URL ↔ tab sync)
│       └── ClaxedoLayoutContent
│           └── RailLayoutInner
│               ├── RailSidebar
│               │   ├── ProjectList
│               │   │   ├── WorkspaceList
│               │   │   │   └── SessionList
│               │   └── ActionButtons (New, Settings, Help)
│               ├── TopTabBar
│               │   ├── TabList (session/terminal/review tabs)
│               │   └── TabActions (+, dropdown)
│               └── TabContentArea
│                   └── Portal Host (for directory-scope content)
```

### 4.3 Portal Pattern for Context Bridging

Directory-scope components need to render in app-scope locations. Solid's Portal pattern preserves context from creation site:

```tsx
// Directory scope (has TerminalProvider)
function ClaxedoDirectoryProvider(props: ParentProps) {
  return (
    <>
      {/* Content portaled to app-scope host */}
      <Portal mount={document.getElementById("TAB_HOST")}>
        <TabSession />  {/* Has access to TerminalProvider */}
      </Portal>
      {props.children}
    </>
  )
}
```

### 4.4 Tab State Management

```typescript
// ClaxedoLayoutContext state shape
interface ClaxedoLayoutState {
  topTabs: {
    workspaceId: string           // Current workspace
    items: TabItem[]              // Tabs for current workspace
    activeId: string              // Active tab ID
  }
  workspaceTabs: Record<string, {
    items: TabItem[]
    activeId: string
  }>
  terminal: {
    requestCreate: (command?: string) => void
  }
}

interface TabItem {
  id: string
  type: "session" | "terminal" | "review"
  title: string
  sessionId?: string
  terminalId?: string
  loading?: boolean
  attention?: boolean
  badge?: { additions: number; deletions: number }
}
```

---

## 5. Extension System

### 5.1 Extension Types

Extensions are defined in `@opencode-ai/app-shared` and registered at runtime:

```typescript
// packages/app-shared/src/extension-points.ts

interface AppExtensions {
  providers?: ParentComponent[]           // Global providers
  authenticatedProviders?: ParentComponent[]  // Post-auth providers
  authGuard?: ParentComponent             // Route protection
  routes?: RouteDefinition[]              // Additional routes
  strings?: I18nStrings                   // i18n overrides
  settingsSections?: SettingsSection[]    // Settings UI
  layoutComponent?: ParentComponent       // Layout replacement
  directoryProviders?: ParentComponent[]  // Per-directory providers
  webProjectDialog?: Component            // Cloud project dialog
  createWorkspace?: (dir: string) => Promise<string | undefined>
  hideShareButton?: boolean
  serverSelectorMode?: "full" | "status-only"
  onInit?: () => Promise<void>
}

interface ServerExtensions {
  transformUrl?: (url: string) => string
}

interface PersistExtensions {
  serverScoped?: boolean
}

interface SyncExtensions {
  onServerChange?: (newUrl: string, oldUrl: string) => void
}
```

### 5.2 Extension Factories

**`appExtensions.ts`** - App-level features:
- Layout replacement (`ClaxedoLayout`)
- Auth providers and guards
- Cloud routes (`/login`)
- Settings sections
- i18n strings

**`serverExtensions.ts`** - Server connection:
- URL transformation/canonicalization

**`persistExtensions.ts`** - State persistence:
- Server-scoped storage configuration

**`syncExtensions.ts`** - Data synchronization:
- Server change notifications
- Cleanup on server switch

### 5.3 Extension Registration

```typescript
// src/index.tsx
import { registerExtensions } from "@opencode-ai/app-shared"
import { appExtensions, serverExtensions, persistExtensions, syncExtensions } from "./extensions"

const config: ClaxedoConfig = {
  authEnabled: import.meta.env.VITE_AUTH_ENABLED === "true",
  sandboxEnabled: import.meta.env.VITE_SANDBOX_ENABLED === "true",
  tunnelEnabled: import.meta.env.VITE_TUNNEL_ENABLED === "true",
  serverScopedPersist: import.meta.env.VITE_SERVER_SCOPED_PERSIST === "true",
}

registerExtensions({
  app: appExtensions(config),
  server: serverExtensions(config),
  persist: persistExtensions(config),
  sync: syncExtensions(config),
})
```

---

## 6. Feature Flags

### 6.1 Environment Variables

| Flag | Default | Purpose |
|------|---------|---------|
| `VITE_AUTH_ENABLED` | `false` | Enable Clerk authentication |
| `VITE_SANDBOX_ENABLED` | `false` | Enable cloud workspace creation |
| `VITE_TUNNEL_ENABLED` | `false` | Enable remote access/tunneling |
| `VITE_SERVER_SCOPED_PERSIST` | `true` | Enable per-server state isolation |
| `VITE_CLERK_PUBLISHABLE_KEY` | - | Clerk authentication key |
| `VITE_CONVEX_URL` | - | Convex backend URL |
| `VITE_OPENCODE_BACKEND_URL` | `http://127.0.0.1:3000` | OpenCode backend URL |

### 6.2 Feature Matrix

| Feature | Auth | Sandbox | Tunnel | Persist |
|---------|------|---------|--------|---------|
| Custom Layout | - | - | - | - |
| Cloud Login | ✓ | - | - | - |
| Auth Guard | ✓ | - | - | - |
| Account Settings | ✓ | - | - | - |
| Cloud Project Dialog | - | ✓ | - | - |
| Workspace Creation | - | ✓ | - | - |
| Remote Access UI | - | - | ✓ | - |
| Server-Scoped Storage | - | - | - | ✓ |

---

## 7. Cloud Components

### 7.1 Authentication (Clerk)

```typescript
// utils/auth-client.ts
import { Clerk } from "@clerk/clerk-js"

export const clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)

export async function waitForClerk() {
  await clerk.load()
}

export function useAuth() {
  // Reactive auth state
  return {
    isSignedIn: () => clerk.user !== null,
    user: () => clerk.user,
    loading: () => !clerk.loaded,
  }
}

export async function getAuthToken(): Promise<string | null> {
  return clerk.session?.getToken() ?? null
}
```

### 7.2 Cloud Project Creation

The `DialogCreateCloudProject` component enables creating cloud workspaces:

1. User selects template or provides Git URL
2. Request sent to claxedo backend
3. Daytona sandbox provisioned
4. Workspace directory returned
5. Navigate to new workspace

### 7.3 Remote Access/Tunneling

When `VITE_TUNNEL_ENABLED`:
- Settings section shows "Remote Access" options
- Can generate shareable tunnel URL
- Tunnel proxies through claxedo backend

---

## 8. Desktop Integration

### 8.1 Tauri Configuration

Desktop builds use Tauri with custom configuration:

```json
// tauri.conf.json (merged with claxedo config)
{
  "productName": "Claxedo",
  "identifier": "ai.claxedo.desktop",
  "build": {
    "frontendDist": "../claxedo-app/dist-desktop"
  }
}
```

### 8.2 Desktop Build Process

1. **Build Frontend**: `vite build --config vite.desktop.config.ts`
   - Uses claxedo overrides
   - Outputs to `dist-desktop/`

2. **Build Desktop**: `tauri build`
   - Uses claxedo frontend
   - Bundles with Rust backend

### 8.3 Tauri Plugins and Capabilities

| Plugin | Purpose |
|--------|---------|
| `@tauri-apps/plugin-deep-link` | Handle `opencode://` URLs |
| `@tauri-apps/plugin-dialog` | Native file dialogs |
| `@tauri-apps/plugin-shell` | Spawn processes |
| `@tauri-apps/plugin-updater` | Auto-update support |
| `@tauri-apps/plugin-store` | Persistent storage |
| `@tauri-apps/plugin-notification` | System notifications |
| `@tauri-apps/plugin-os` | OS information |
| `@tauri-apps/plugin-process` | Process management |

### 8.4 Deep Linking

Handles `opencode://` URLs:
- `opencode://session/{id}` - Open specific session
- `opencode://project/{path}` - Open project directory

### 8.5 Auto-Updater

Production builds check for updates via configured endpoint:
```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://releases.example.com/latest.json"]
    }
  }
}
```

---

## 9. Backend Server Integration

The Claxedo frontend communicates with a dedicated backend server (`claxedo/`) that provides cloud infrastructure services.

### 9.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Claxedo App (This Package)                            │
│                       packages/claxedo-app                               │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────────┐│
│  │  UI Components │  │   Contexts    │  │        API Client             ││
│  │  (SolidJS)     │  │  (Providers)  │  │  (fetch to gateway)           ││
│  └───────────────┘  └───────────────┘  └───────────────────────────────┘│
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Claxedo Gateway Server                                │
│                           claxedo/                                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────┐│
│  │    Routes     │  │     Proxy     │  │  Orchestrator │  │Observabil.││
│  │   (Hono)      │  │ (Dir/WS/PTY)  │  │   (Sandbox)   │  │(OTEL/Prom)││
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────┘│
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Convex      │    │     Daytona     │    │      Clerk      │
│   (Database)    │    │   (Sandboxes)   │    │     (Auth)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 9.2 Communication Patterns

**Vite Dev Proxy:**
During development, Vite proxies API requests to the gateway:

```typescript
// vite.cloud.config.ts
proxy: {
  "/api/workspace": { target: gatewayUrl },
  "/w/": { target: gatewayUrl, ws: true },
  "/pty": { target: gatewayUrl, ws: true },
  // ... other routes
}
```

**Request Flow:**

| Frontend Action | Gateway Endpoint | Backend Service |
|-----------------|------------------|-----------------|
| Create workspace | `POST /api/workspace/create` | Orchestrator → Daytona |
| Open session | `GET /w/:id/session/*` | Proxy → Sandbox OpenCode |
| Terminal I/O | `WS /w/:id/pty/:ptyId/connect` | WebSocket → Sandbox PTY |
| Store credentials | `PUT /auth/:provider` | Intercepted → Convex |
| List providers | `GET /provider` | Augmented from Convex |

### 9.3 Directory-Based Routing

The frontend includes workspace directory in requests via header:

```typescript
// Frontend request
fetch("/session/list", {
  headers: {
    "x-opencode-directory": "/workspace/proj-123/main"
  }
})
```

The gateway resolves this to the appropriate sandbox:
1. Query Convex for workspace by directory
2. Get sandbox URL from workspace
3. Wake sandbox if sleeping
4. Proxy request to sandbox

### 9.4 Authentication Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Clerk (Client) │────▶│ Claxedo Gateway │────▶│ Convex/Daytona  │
│                 │     │                 │     │                 │
│  1. Sign in     │     │  2. Verify JWT  │     │  3. Check org   │
│  Get JWT token  │     │  Extract orgId  │     │  ownership      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

The frontend attaches JWT to requests:
```typescript
const token = await getAuthToken()
fetch(url, {
  headers: { Authorization: `Bearer ${token}` }
})
```

### 9.5 Credential Management

AI provider credentials flow through the system:

1. **User enters API key** in OpenCode settings
2. **Frontend intercepts** `/auth/:provider` PUT
3. **Gateway encrypts** key with AES-256-GCM
4. **Stored in Convex** (encrypted)
5. **Synced to all sandboxes** in organization

### 9.6 Backend Documentation

For detailed backend architecture, see:
- **[claxedo/ARCHITECTURE.md](../../claxedo/ARCHITECTURE.md)** - Server architecture, routes, proxy system
- **[claxedo/OBSERVABILITY.md](../../claxedo/OBSERVABILITY.md)** - Tracing, metrics, error tracking

### 9.7 Local Development

To run the full stack locally:

```bash
# Terminal 1: Start gateway
cd claxedo
bun run dev

# Terminal 2: Start frontend
cd packages/claxedo-app
bun run dev

# Frontend will proxy to gateway at localhost:3000
```

---

## 10. Process Control Plane Feature

The Process Control Plane feature is tracked as a Claxedo-first feature plan, aligned to the existing override, terminal, and gateway architecture.

- Source of truth spec: **[docs/PROCESS_CONTROL_PLANE_V1.md](./docs/PROCESS_CONTROL_PLANE_V1.md)**
- Scope: local project/process orchestration, terminal interaction, trust gating, MCP-safe automation, and config-first operation.
- Delivery model: phased rollout across `packages/claxedo-app`, `claxedo/`, and targeted `opencode` command surfaces.

---

## Appendix

### A. File Override Manifest

| Override | Upstream | Reason | Last Synced |
|----------|----------|--------|-------------|
| `app.tsx` | `app/src/app.tsx` | Extension system entry | 2026-02-01 |
| `context/terminal.tsx` | `app/src/context/terminal.tsx` | Server-scoped persist | 2026-02-01 |
| `context/server.tsx` | `app/src/context/server.tsx` | URL transform, workspace map | 2026-02-01 |
| `context/layout.tsx` | `app/src/context/layout.tsx` | Global orchestration | 2026-02-01 |
| ... | ... | ... | ... |

### B. Useful Commands

```bash
# Development
bun run dev                    # Start web dev server
bun run desktop:dev            # Start desktop dev

# Building
bun run build                  # Build web
bun run desktop:build          # Build desktop
bun run desktop:build --prod   # Build desktop (production)

# Type checking
bun run typecheck

# Verify upstream is pristine
git diff upstream/dev -- packages/app packages/ui packages/desktop
```

### C. Troubleshooting

**"useX must be used within XProvider"**
- Check if component is in correct scope (app vs directory)
- Use `useGlobalSync().child(dir)` for app-scope access to directory data
- Use Portal pattern for rendering directory content in app locations

**Override not being picked up**
- Verify file path matches exactly (`context/terminal.tsx` not `context/Terminal.tsx`)
- Check `CLAXEDO_OVERRIDES=1` is set
- Restart dev server after adding new override files

**Desktop build using wrong frontend**
- Ensure `frontendDist` points to `claxedo-app/dist-desktop`
- Check `beforeBuildCommand` is disabled (claxedo builds separately)
