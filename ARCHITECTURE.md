# OpenWork Architecture Documentation

> Comprehensive developer guide to understanding the codebase architecture, conventions, and patterns.

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [Technology Stack](#technology-stack)
4. [Package Architecture](#package-architecture)
5. [State Management](#state-management)
6. [Component Patterns](#component-patterns)
7. [Styling System](#styling-system)
8. [Routing](#routing)
9. [Platform Abstraction](#platform-abstraction)
10. [Data Flow](#data-flow)
11. [Code Conventions](#code-conventions)
12. [Build Tooling](#build-tooling)

---

## Overview

**OpenWork** is an enhanced fork of OpenCode, designed for workspace and file collaboration among knowledge workers. It extends OpenCode's AI-powered agent capabilities to support collaborative workflows across various file types and workspace environments.

### Key Characteristics

- **Monorepo**: 18 packages managed with Bun + Turborepo
- **Cross-platform**: Web and desktop (Tauri) from shared codebase
- **Reactive UI**: Solid.js with fine-grained reactivity
- **Type-safe**: TypeScript + Zod runtime validation

---

## Project Structure

```
openwork/
├── packages/                    # Main packages
│   ├── app/                     # Core web UI (shared across platforms)
│   ├── desktop/                 # Tauri desktop wrapper
│   ├── ui/                      # Reusable UI component library
│   ├── sdk/                     # TypeScript SDK for API client
│   ├── opencode/                # Main server & CLI logic
│   ├── plugin/                  # Plugin system for extensions
│   ├── util/                    # Shared utilities
│   ├── identity/                # Branding/visual identity assets
│   ├── web/                     # Web app deployment
│   └── enterprise/              # Enterprise-specific features
├── specs/                       # Feature specifications
│   ├── 001-workspace-files-sidebar/
│   ├── 002-file-preview-viewer/
│   ├── 003-file-activity-highlight/
│   ├── 004-mcp-connectors/
│   └── 006-fix-mcp-api-alignment/
├── tauri-plugin-mcp/            # Custom Tauri plugin for MCP
├── CLAUDE.md                    # AI assistant instructions
├── AGENTS.md                    # Agent configuration
└── turbo.json                   # Turborepo configuration
```

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| Solid.js | 1.9.10 | Reactive UI framework |
| Tailwind CSS | 4.1.11 | Utility-first styling |
| Vite | 7.1.4 | Build tool |
| @kobalte/core | 0.13.11 | Headless UI components |
| TypeScript | 5.8.2 | Type safety |

### Desktop

| Technology | Version | Purpose |
|------------|---------|---------|
| Tauri | 2.x | Native desktop framework |
| Rust | 2024 Edition | Backend runtime |
| Various Tauri plugins | - | dialog, shell, notification, store, etc. |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Bun | 1.3.5 | JavaScript runtime |
| Hono | - | Web framework |
| Zod | - | Runtime validation |

---

## Package Architecture

### Core Packages

#### `packages/app/` - Core Web UI

The main application UI, shared between web and desktop builds.

```
app/
├── src/
│   ├── app.tsx              # Provider hierarchy & routing setup
│   ├── entry.tsx            # Platform detection & render entry
│   ├── components/          # 29 component files
│   │   ├── session/         # Session-related UI
│   │   ├── file-preview/    # File preview panel
│   │   ├── workspace-sidebar.tsx
│   │   ├── file-tree.tsx
│   │   └── terminal.tsx
│   ├── context/             # 18 context providers
│   │   ├── layout.tsx       # UI state management
│   │   ├── global-sdk.tsx   # SDK + event streaming
│   │   ├── server.tsx       # Server connection
│   │   ├── terminal.tsx     # PTY management
│   │   └── file-activity.tsx
│   ├── pages/               # Route pages
│   │   ├── session.tsx      # Main session view
│   │   ├── layout.tsx       # Page layout wrapper
│   │   └── home.tsx
│   ├── types/               # TypeScript definitions
│   └── utils/               # Utilities (persist, prompt, etc.)
├── public/                  # Static assets
└── vite.config.ts
```

#### `packages/ui/` - Component Library

Reusable UI components with consistent styling.

```
ui/
├── src/
│   ├── components/          # 86 component files
│   │   ├── button.tsx       # + button.css
│   │   ├── dialog.tsx       # + dialog.css
│   │   ├── tabs.tsx         # + tabs.css
│   │   ├── code.tsx         # Code display
│   │   ├── diff.tsx         # Diff viewer
│   │   └── session-*.tsx    # Session components
│   ├── context/             # 8 context providers
│   │   ├── marked.tsx       # Markdown rendering
│   │   ├── dialog.tsx       # Dialog management
│   │   └── helper.tsx       # createSimpleContext utility
│   ├── theme/               # Theme system
│   │   ├── context.tsx      # Theme provider
│   │   ├── color.ts         # Color utilities (oklch, hex, rgb)
│   │   └── themes/          # 10 built-in themes
│   ├── hooks/               # Custom hooks
│   └── styles/              # CSS organization
│       ├── index.css        # Main entry (layers)
│       ├── colors.css       # Color variables
│       └── tailwind/        # Tailwind 4 integration
└── vite.config.ts
```

#### `packages/desktop/` - Tauri Desktop App

Native desktop wrapper using Tauri.

```
desktop/
├── src-tauri/
│   ├── Cargo.toml           # Rust dependencies
│   ├── src/lib.rs           # Tauri commands
│   ├── tauri.conf.json      # App configuration
│   └── .mcp.json            # MCP server definitions
├── vite.config.ts           # Tauri-specific Vite config
└── scripts/predev.ts
```

---

## State Management

### Context-Based Architecture

OpenWork uses Solid.js contexts for state management (no Redux/Zustand).

#### `createSimpleContext` Helper

Custom wrapper that simplifies context creation:

```typescript
// packages/ui/src/context/helper.tsx
export function createSimpleContext<T>(
  name: string,
  init: () => T,
  options?: { ready?: () => boolean }
) {
  const Context = createContext<T>()

  function Provider(props: ParentProps) {
    const value = init()
    return <Context.Provider value={value}>{props.children}</Context.Provider>
  }

  function use() {
    const ctx = useContext(Context)
    if (!ctx) throw new Error(`${name} context not found`)
    return ctx
  }

  return { provider: Provider, use }
}
```

#### Provider Hierarchy

Providers are nested in a specific order in `app.tsx`:

```
PlatformProvider
└─ ThemeProvider
   └─ DialogProvider
      └─ MarkedProvider
         └─ ServerProvider
            └─ GlobalSDKProvider
               └─ GlobalSyncProvider
                  └─ PermissionProvider
                     └─ LayoutProvider
                        └─ NotificationProvider
                           └─ CommandProvider
                              └─ [Page-specific providers]
```

### Key Contexts

| Context | File | Purpose |
|---------|------|---------|
| `LayoutProvider` | `context/layout.tsx` | UI state (sidebars, panels, tabs) |
| `GlobalSDKProvider` | `context/global-sdk.tsx` | SDK client + event streaming |
| `ServerProvider` | `context/server.tsx` | Server connection management |
| `TerminalProvider` | `context/terminal.tsx` | PTY management |
| `FileActivityProvider` | `context/file-activity.tsx` | File read/edit tracking |
| `McpConnectorsProvider` | `context/mcp-connectors.tsx` | MCP server configuration |

### Persistence Strategy

Storage abstraction in `utils/persist.ts`:

```typescript
// Usage
const [state, setState] = persisted<MyState>("key", defaultValue, {
  scope: "workspace", // or "global" or "session"
})
```

**Storage targets:**
- **Web**: localStorage
- **Desktop**: Tauri @tauri-apps/plugin-store

**Key patterns:**
- Global: `opencode.global.dat`
- Workspace: `opencode.workspace.{prefix}.{checksum}.dat`
- Session: With session prefix added

---

## Component Patterns

### Base Component Pattern

Components wrap @kobalte/core primitives with custom styling:

```typescript
// packages/ui/src/components/button.tsx
export interface ButtonProps extends ComponentProps<typeof Kobalte.Button> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconProps["name"]
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["size", "variant", "icon", "children", "class"])

  return (
    <Kobalte.Button
      data-component="button"
      data-size={local.size || "normal"}
      data-variant={local.variant || "primary"}
      class={local.class}
      {...rest}
    >
      {local.icon && <Icon name={local.icon} />}
      {local.children}
    </Kobalte.Button>
  )
}
```

### Compound Components

Complex components use compound pattern:

```typescript
// Collapsible example
export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
  Arrow: CollapsibleArrow,
})

// Usage
<Collapsible defaultOpen>
  <Collapsible.Trigger>Toggle</Collapsible.Trigger>
  <Collapsible.Content>Content here</Collapsible.Content>
</Collapsible>
```

### Component + CSS Pairing

Each component has a paired CSS file:

```
components/
├── button.tsx
├── button.css
├── dialog.tsx
├── dialog.css
└── ...
```

CSS uses data attributes for styling:

```css
/* button.css */
[data-component="button"] {
  /* base styles */

  &[data-size="small"] { /* small variant */ }
  &[data-size="large"] { /* large variant */ }

  &[data-variant="primary"] { /* primary variant */ }
  &[data-variant="ghost"] { /* ghost variant */ }
}
```

---

## Styling System

### CSS Layers

Styles are organized into cascade layers:

```css
/* packages/ui/src/styles/index.css */
@layer theme, base, components, utilities;
```

| Layer | Purpose | Priority |
|-------|---------|----------|
| `theme` | Color system, spacing, typography variables | Lowest |
| `base` | Reset, global styles, KaTeX | |
| `components` | Component-specific styles | |
| `utilities` | Custom utilities, animations | Highest |

### Color System

Semantic color variables in `colors.css`:

```css
:root {
  /* Text colors */
  --text-base: ...;
  --text-strong: ...;
  --text-weak: ...;
  --text-muted: ...;

  /* Surface colors */
  --surface-base: ...;
  --surface-raised-base: ...;
  --surface-raised-base-hover: ...;

  /* Border colors */
  --border-base: ...;
  --border-weak-base: ...;

  /* Interactive colors */
  --text-interactive-base: ...;
  --surface-interactive-base: ...;
}
```

### Tailwind 4 Integration

Tailwind 4 with custom configuration:

```css
/* Custom spacing */
--spacing: 0.25rem; /* 4px baseline */

/* Custom breakpoints */
@media (min-width: 640px) { /* sm */ }
@media (min-width: 768px) { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

### Theme System

10 built-in themes with dynamic switching:

```typescript
// packages/ui/src/theme/context.tsx
const theme = useTheme()

theme.setTheme("tokyonight")  // Switch theme
theme.setColorScheme("dark")   // Light/dark/system
```

Available themes: openwork, tokyonight, dracula, github, etc.

---

## Routing

### @solidjs/router Configuration

```typescript
// packages/app/src/app.tsx
<Router root={Layout}>
  <Route path="/" component={Home} />
  <Route path="/:dir" component={DirectoryLayout}>
    <Route path="/" component={Navigate to="session"} />
    <Route path="/session/:id?" component={Session} />
  </Route>
</Router>
```

### URL Structure

- `/` - Home page
- `/:dir` - Directory/workspace view (base64 encoded path)
- `/:dir/session` - New session
- `/:dir/session/:id` - Specific session

### Navigation Utilities

```typescript
import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode, base64Decode } from "@opencode-ai/util/encode"

const navigate = useNavigate()
const params = useParams()

// Navigate to workspace
navigate(`/${base64Encode(directoryPath)}/session`)

// Get current directory
const directory = params.dir ? base64Decode(params.dir) : undefined
```

---

## Platform Abstraction

### PlatformProvider

Abstracts platform differences:

```typescript
// packages/app/src/context/platform.tsx
const platform = usePlatform()

// Platform detection
platform.type  // "web" | "desktop"

// Platform-specific methods
platform.openLink(url)           // Open external link
platform.notify(title, desc)     // Show notification
platform.restart()               // Restart app
platform.fetch(url, options)     // Custom fetch (Tauri bridge)
platform.storage                 // Storage abstraction
```

### Desktop-Specific Features

```typescript
// File dialogs
const result = await platform.openDirectoryPickerDialog({
  title: "Open project",
  multiple: true,
})

// File system access (desktop only)
await platform.writeFile(path, content)
const content = await platform.readFile(path)
```

---

## Data Flow

### Event Streaming

SDK emits events via streaming endpoint:

```typescript
// packages/app/src/context/global-sdk.tsx
const globalSDK = useGlobalSDK()

// Listen to events
globalSDK.event.listen((event) => {
  // Handle event
})

// Events are coalesced by key (16ms debounce)
// Keys: session.status, lsp.updated, message.part.updated
```

### Session State Flow

```
User Action → Context Update → Store Update → UI Re-render
                    ↓
              Persistence (localStorage/Tauri store)
```

### File Activity Tracking

```typescript
// packages/app/src/context/file-activity.tsx
const fileActivity = useFileActivity()

// Track file activity
fileActivity.track(path, "read")    // File was read
fileActivity.track(path, "edited")  // File was edited
fileActivity.track(path, "created") // File was created

// Get activity
fileActivity.get(path)              // { type, timestamp }
fileActivity.getAllPaths()          // All tracked paths
```

---

## Code Conventions

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `Button`, `SessionTurn` |
| Hooks | camelCase with `use`/`create` | `useLayout`, `createAutoScroll` |
| Context files | kebab-case | `file-activity.tsx` |
| Context exports | PascalCase | `FileActivityProvider` |
| Types/Interfaces | PascalCase | `ButtonProps`, `McpServer` |
| CSS files | kebab-case | `button.css`, `session-turn.css` |

### File Organization

```
component-name.tsx    # Component implementation
component-name.css    # Component styles (paired)
```

### Props Pattern

```typescript
interface MyComponentProps extends ComponentProps<"div"> {
  customProp: string
  optionalProp?: number
}

function MyComponent(props: MyComponentProps) {
  const [local, rest] = splitProps(props, ["customProp", "optionalProp"])

  return (
    <div {...rest}>
      {local.customProp}
    </div>
  )
}
```

### Error Handling

```typescript
// Error boundaries in app.tsx
<ErrorBoundary fallback={(err) => <ErrorView error={err} />}>
  {children}
</ErrorBoundary>

// Toast notifications
import { showToast } from "@opencode-ai/ui/toast"
showToast({ title: "Error", description: "Something went wrong" })

// Dialog confirmations
const dialog = useDialog()
dialog.show(() => <ConfirmDialog />)
```

### Validation with Zod

```typescript
import { z } from "zod"

const MySchema = z.object({
  name: z.string().min(1),
  count: z.number().int().positive(),
})

type MyType = z.infer<typeof MySchema>

// Validate
const result = MySchema.safeParse(data)
if (!result.success) {
  // Handle validation errors
}
```

---

## Build Tooling

### Vite Configuration

```typescript
// packages/app/vite.config.ts
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      "@/": "./src/",
    },
  },
})
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Commands

```bash
# Development
bun dev              # Start dev server
bun dev:desktop      # Start Tauri dev

# Build
bun build            # Build for production
bun build:desktop    # Build Tauri app

# Testing
bun test             # Run tests
cargo test           # Run Rust tests
cargo clippy         # Rust linting
```

### Turborepo

Task orchestration via `turbo.json`:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

---

## Quick Reference

### Common Imports

```typescript
// Solid.js
import { createSignal, createEffect, createMemo, Show, For } from "solid-js"
import { createStore } from "solid-js/store"

// Router
import { useNavigate, useParams, A } from "@solidjs/router"

// UI Components
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"

// Contexts
import { useLayout } from "@/context/layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"

// Utilities
import { base64Encode, base64Decode } from "@opencode-ai/util/encode"
```

### Creating a New Component

1. Create `packages/ui/src/components/my-component.tsx`
2. Create `packages/ui/src/components/my-component.css`
3. Add CSS import to `packages/ui/src/styles/index.css`
4. Export from `packages/ui/src/index.ts`

### Creating a New Context

1. Create `packages/app/src/context/my-context.tsx`
2. Use `createSimpleContext` helper
3. Add provider to hierarchy in `app.tsx`
4. Export hook for consumption

---

## Additional Resources

- [Solid.js Documentation](https://solidjs.com/docs)
- [Tauri Documentation](https://tauri.app/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Kobalte Documentation](https://kobalte.dev)
- [Zod Documentation](https://zod.dev)
