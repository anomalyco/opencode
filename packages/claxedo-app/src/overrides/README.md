# Claxedo File Overrides

This directory contains file overrides for the upstream `@opencode-ai/app` package.

## How It Works

The override system uses Vite's resolve.alias configuration to redirect `@/...` imports
to files in this directory instead of the upstream package.

When `CLAXEDO_OVERRIDES=1` is set:
1. Vite scans this directory for `.ts` and `.tsx` files
2. Creates aliases mapping `@/path/to/file` to `src/overrides/path/to/file`
3. These aliases take precedence over the general `@/` alias pointing to `packages/app/src/`

## File Manifest

| Override File | Upstream File | Reason |
|---------------|---------------|--------|
| `app.tsx` | `packages/app/src/app.tsx` | Extension system integration |
| `context/global-sdk.tsx` | `packages/app/src/context/global-sdk.tsx` | Context consistency (imports server/platform) |
| `context/global-sync.tsx` | `packages/app/src/context/global-sync.tsx` | onServerChange hook |
| `context/language.tsx` | `packages/app/src/context/language.tsx` | Extension strings merge |
| `context/layout.tsx` | `packages/app/src/context/layout.tsx` | Context consistency (imports server/global-sync/global-sdk) |
| `context/notification.tsx` | `packages/app/src/context/notification.tsx` | Context consistency (imports global-sdk/global-sync) |
| `context/permission.tsx` | `packages/app/src/context/permission.tsx` | Context consistency (imports global-sync) |
| `context/sdk.tsx` | `packages/app/src/context/sdk.tsx` | Context consistency (imports global-sdk/platform) |
| `context/server.tsx` | `packages/app/src/context/server.tsx` | transformUrl extension |
| `context/terminal.tsx` | `packages/app/src/context/terminal.tsx` | Server-scoped persist, cwd tracking |
| `pages/home.tsx` | `packages/app/src/pages/home.tsx` | webProjectDialog, serverSelectorMode |
| `pages/layout.tsx` | `packages/app/src/pages/layout.tsx` | layoutComponent extension |
| `pages/directory-layout.tsx` | `packages/app/src/pages/directory-layout.tsx` | directoryProviders, resolveSessionUrl |
| `components/settings-general.tsx` | `packages/app/src/components/settings-general.tsx` | settingsSections extension |
| `components/status-popover.tsx` | `packages/app/src/components/status-popover.tsx` | serverSelectorMode |
| `utils/persist.ts` | `packages/app/src/utils/persist.ts` | Server-scoped storage helpers |

## Adding New Overrides

1. Copy the upstream file to the same relative path in this directory:
   ```bash
   cp packages/app/src/components/my-component.tsx packages/claxedo-app/src/overrides/components/
   ```

2. The file will be automatically picked up by Vite - no config change needed!

3. Make your changes to the override file.

## Import Conventions

### Within Override Files

Always use `@/...` for imports from the app package:

```typescript
// Good
import { useSDK } from "@/context/sdk"
import { Link } from "@/components/link"

// Bad - relative imports to upstream files won't work
import { useSDK } from "./sdk"
import { Link } from "./link"
```

### From Other Claxedo Files

When importing contexts/hooks/components that are overridden, import from `@opencode-ai/claxedo-app` instead of `@opencode-ai/app`:

```typescript
// Good - gets the overridden version
import { useGlobalSync, useGlobalSDK, useServer } from "@opencode-ai/claxedo-app"

// Bad - gets the upstream version (may cause context mismatch errors)
import { useGlobalSync, useGlobalSDK, useServer } from "@opencode-ai/app"
```

The following should be imported from `@opencode-ai/claxedo-app`:
- `useGlobalSync`, `GlobalSyncProvider`
- `useGlobalSDK`, `GlobalSDKProvider`
- `useLayout`, `LayoutProvider`
- `useServer`, `ServerProvider`
- `usePlatform`, `PlatformProvider`
- `useTerminal`, `TerminalProvider`
- `useSettings`, `SettingsProvider`
- `useCommand`, `CommandProvider`
- `useLanguage`, `LanguageProvider`
- `useSync`, `SyncProvider`
- `useFile`, `FileProvider`
- `useComments`, `CommentsProvider`
- `usePrompt`, `PromptProvider`
- `Persist`, `persisted`
- `Terminal`, `PromptInput`, `Titlebar`

The following can still be imported from `@opencode-ai/app`:
- `AppBaseProviders`, `AppInterface`
- `AppProvider` components that don't depend on overridden contexts

Use `@claxedo/...` for imports from claxedo-app's own modules:

```typescript
import { getExtensions } from "@claxedo/extensions"
```

## Context Level Architecture

The app has two levels of context providers:

### App Level (Outside SDKProvider)
- `ClaxedoLayoutProvider`
- `CommandProvider`
- `GlobalSyncProvider` (overridden)
- `GlobalSDKProvider` (overridden)
- `ServerProvider` (overridden)
- etc.

### Directory Level (Inside SDKProvider)
- `TerminalProvider` (overridden)
- `SyncProvider`
- `FileProvider`
- etc.

**Important**: Components at the app level cannot use hooks that depend on directory-level providers:

| Component | Level | Uses | Required Provider | Status |
|-----------|-------|------|-------------------|--------|
| `TabSession` | App | `useSync()` | `SyncProvider` (directory) | ❌ Cannot render |
| `TabTerminal` | App | `useTerminal()` | `TerminalProvider` (directory) | ❌ Cannot render |
| `TabReview` | App | `useSync()` | `SyncProvider` (directory) | ❌ Cannot render |

### Solution: Portal Pattern

To render directory-scoped content inside app-scoped UI, we use **Solid's Portal**:

1. **App scope** renders a DOM *host* (mount point) with a stable ID
2. **Directory scope** creates the content under providers and **Portals** it into the host

**Why this works**: Solid context is tied to component owner (creation site), not DOM insertion.

```
App branch (no directory providers)
ClaxedoLayout
└─ RailLayout
   └─ TabContentArea
      └─ <div id="claxedo-tab-host-TAB_ID" />  ← Host

Directory branch (has directory providers)
DirectoryLayout
└─ SDKProvider
   └─ SyncProvider
      └─ TabPortal  ← Creates content here
         └─ Portal(mount=#claxedo-tab-host-TAB_ID)
            └─ TabSession / TabReview  ✅ hooks work!
```

### Implementation

**TabContentArea** (app scope): Renders host elements
```tsx
<div id={getTabHostId(tab.id)} />
```

**TabPortal** (directory scope, registered as `directoryProvider`): Renders content via Portal
```tsx
<Portal mount={document.getElementById(hostId)}>
  <TabSession sessionId={tab.sessionId} />
</Portal>
```

**Terminal** is handled separately by `TerminalContentWrapperInner` which also runs in directory scope and renders terminal as an overlay.

See `CLAXEDO_CONTEXT_FIXES.md` for full architecture details.

For a more complete guide (including Portal-host rendering and when to use global vs directory state), see `CLAXEDO_CONTEXT_FIXES.md`.

## Build Commands

```bash
# Development with overrides enabled
bun run dev

# Production build with overrides enabled
bun run build

# Desktop dev with overrides
bun run desktop:dev
```

All scripts automatically set `CLAXEDO_OVERRIDES=1`.

## Disabling Overrides

To temporarily disable overrides and use pristine upstream files:

```bash
CLAXEDO_OVERRIDES=0 bun run dev
```

## Maintenance

When upstream changes an overridden file:

1. The `sync-upstream.sh` script (from CLAXEDO_UPSTREAM_SYNC.md) will detect changes
2. Manually review and merge upstream changes into the override file
3. Test the build: `bun run build`
 
If you don't have a script, you can still detect changes by comparing upstream files under `packages/app/src/**` with their corresponding override paths in `packages/claxedo-app/src/overrides/**` (see `packages/claxedo-app/.dev-docs/CLAXEDO_UPSTREAM_SYNC.md`).
