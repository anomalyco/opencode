# Code Conventions

**Last Updated:** 2026-01-15

This document outlines the code conventions and patterns used throughout the OpenWork codebase.

## Table of Contents

- [File Naming](#file-naming)
- [Import Organization](#import-organization)
- [TypeScript Patterns](#typescript-patterns)
- [State Management](#state-management)
- [Styling Conventions](#styling-conventions)
- [Error Handling](#error-handling)
- [Code Style](#code-style)

---

## File Naming

### Component Files
Use **kebab-case** for all component files:
```
workspace-sidebar.tsx     # ✓ Good
WorkspaceSidebar.tsx      # ✗ Avoid
```

### Feature-Prefixed Naming
Group related files with feature prefixes:
```
file-activity-section.tsx
file-activity-item.tsx
file-activity-badge.tsx

mcp-connector-form.tsx
mcp-connector-item.tsx
mcp-connectors-section.tsx
```

### Dialog Components
Prefix dialog components with `dialog-`:
```
dialog-select-file.tsx
dialog-connect-provider.tsx
dialog-settings.tsx
```

### Context Files
Place in `/context/` directory with descriptive names:
```
context/
├── layout.tsx
├── file-activity.tsx
├── mcp-connectors.tsx
└── sdk.tsx
```

### Type Definition Files
Place in `/types/` directory:
```
types/
├── mcp-connectors.ts
├── file-activity.ts
└── session.ts
```

### Utility Files
Place in `/utils/` directory:
```
utils/
├── persist.ts
├── dom.ts
├── id.ts
└── perf.ts
```

### Index Files
Use for export aggregation:
```typescript
// components/session/index.ts
export * from "./message"
export * from "./toolbar"
export * from "./status"
```

---

## Import Organization

### Order of Imports
Follow this consistent ordering:

```typescript
// 1. External dependencies (first)
import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup, onMount } from "solid-js"

// 2. Internal UI components/contexts
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"

// 3. App contexts
import { useLayout } from "@/context/layout"
import { useFileActivity } from "@/context/file-activity"

// 4. Types (use `type` imports)
import type { FileActivityType, FileActivityState } from "@/types/file-activity"

// 5. Local imports
import { MyComponent } from "./my-component"
import { helperFunction } from "./helpers"
```

### Path Aliases
Use configured path aliases:
```typescript
// Use aliases
import { useLayout } from "@/context/layout"              // ✓
import { Button } from "@opencode-ai/ui/button"           // ✓

// Avoid relative paths for deep imports
import { useLayout } from "../../../context/layout"       // ✗
```

### Available Aliases
| Alias | Path |
|-------|------|
| `@/` | `packages/app/src/` |
| `@opencode-ai/ui/` | `packages/ui/src/` |
| `@opencode-ai/sdk/` | `packages/sdk/js/src/` |
| `@opencode-ai/util/` | `packages/util/src/` |

---

## TypeScript Patterns

### Interface vs Type
- Use **interfaces** for component props and object shapes
- Use **types** for unions, primitives, and utility types

```typescript
// Interface for props
export interface ComponentProps {
  name: string
  value?: number
  class?: string
  children?: any
}

// Type for unions
export type ReviewDiffStyle = "unified" | "split"

// Type for computed types
export type FileState = Pick<FullFileState, "path" | "status">
```

### Props Interface Pattern
```typescript
export interface WorkspaceSidebarProps {
  class?: string
  onFileClick?: (file: LocalFile) => void
  onFileActivate?: (file: LocalFile) => void
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  // Component implementation
}
```

### Generic Types
Use generics for flexibility:
```typescript
export interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
  validationErrors?: ValidationError[]
}

// Usage
const result: OperationResult<McpConfig> = await saveConfig()
```

### Extensible Interfaces
Use index signatures for extensibility:
```typescript
export interface McpServer {
  command: string
  args?: string[]
  env?: Record<string, string>
  [key: string]: unknown  // Allow additional properties
}
```

### Type Guards
Create type guard functions for runtime checks:
```typescript
function isTextPart(part: MessagePart): part is TextPart {
  return part.type === "text"
}
```

---

## State Management

### Solid.js Primitives

#### `createSignal` - Simple reactive state
```typescript
const [isLoading, setIsLoading] = createSignal(false)
const [selectedFile, setSelectedFile] = createSignal<LocalFile | null>(null)
```

#### `createStore` - Object-based state
```typescript
const [config, setConfig] = createStore<McpConfig>({
  mcpServers: {},
  defaults: {}
})

// Update nested values
setStore("mcpServers", serverName, "enabled", true)
```

#### `createMemo` - Computed values
```typescript
const sortedFiles = createMemo(() => {
  return [...files()].sort((a, b) => b.timestamp - a.timestamp)
})
```

#### `createEffect` - Side effects
```typescript
createEffect(() => {
  const file = selectedFile()
  if (file) {
    loadFileContent(file.path)
  }
})
```

### Store Immutability Pattern
```typescript
// Direct path updates
setStore("sessionView", sessionKey, "opened", true)

// Using produce for complex updates
setStore("sessionView", sessionKey, produce((draft) => {
  draft.files[path] = newState
  draft.lastModified = Date.now()
}))

// Batch updates for performance
batch(() => {
  setStore("sidebar", "width", newWidth)
  setStore("sidebar", "opened", true)
})
```

### Cleanup Pattern
Always cleanup subscriptions:
```typescript
const unsub = sdk.event.on("session.updated", handler)
onCleanup(unsub)
```

### Persistence Pattern (from `packages/app/src/utils/persist.ts`)

The app uses a custom `persisted()` wrapper around `@solid-primitives/storage`:

```typescript
import { Persist, persisted } from "@/utils/persist"

// Global persistence (app-wide settings)
const [store, setStore, _, ready] = persisted(
  Persist.global("layout", ["layout.v8"]),  // key + legacy keys for migration
  createStore(DEFAULT_STATE)
)

// Workspace persistence (per-project)
const [store, setStore, _, ready] = persisted(
  Persist.workspace(directory, "workspace-settings"),
  createStore(DEFAULT_STATE)
)

// Session persistence (per-session)
const [store, setStore, _, ready] = persisted(
  Persist.session(directory, sessionId, "session-state"),
  createStore(DEFAULT_STATE)
)
```

**Key features:**
- Returns `[Store, SetStore, InitPromise, ReadyAccessor]`
- Supports legacy key migration
- Auto-merges defaults with stored values
- Platform-aware: uses `localStorage` on web, `@tauri-apps/plugin-store` on desktop
- Storage files: `opencode.global.dat`, `opencode.workspace.{hash}.dat`

---

## Styling Conventions

### Tailwind CSS
Use utility-first Tailwind classes:
```tsx
<div class="flex flex-col gap-2 p-4 bg-surface-base border border-border-weak">
  <span class="text-sm text-text-muted">Label</span>
</div>
```

### Class Composition
```tsx
<div
  class={`flex items-center gap-2 ${props.class ?? ""}`}
  classList={{
    "bg-surface-raised-base-hover": !isSelected(),
    "bg-surface-interactive-base": isSelected(),
    [activityConfig()?.background ?? ""]: !!activity(),
  }}
>
```

### CSS Custom Properties
Use design tokens for consistency:
```css
/* Color tokens */
text-text-base
text-text-muted
text-text-interactive

bg-surface-base
bg-surface-raised-base
bg-surface-interactive-base

border-border-weak-base
border-border-weak-selected
```

### Data Attributes for Styling
```tsx
<button
  data-component="button"
  data-size="normal"
  data-variant="primary"
>
```

### Inline Styles
Use sparingly, only for dynamic values:
```tsx
<div style={`padding-left: ${level * 12 + 8}px`}>
```

---

## Error Handling

### Result Type Pattern
```typescript
export interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
  validationErrors?: ValidationError[]
}

// Usage
const result = await mcpConnectors.addServer(name, server)
if (!result.success) {
  handleErrors(result.validationErrors)
  return
}
processData(result.data)
```

### Try-Catch Pattern
```typescript
try {
  const result = await sdk.client.file.read({ path })
  setContent(result.content)
} catch (err: unknown) {
  const errorMessage = err instanceof Error ? err.message : "Unknown error"
  setError(errorMessage)
}
```

### Zod Validation
```typescript
import { z } from "zod"

const McpServerSchema = z.object({
  command: z.string().min(1, "Command is required"),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
})

// Validate with error mapping
const result = McpServerSchema.safeParse(input)
if (!result.success) {
  return {
    success: false,
    validationErrors: result.error.errors.map(e => ({
      field: e.path.join("."),
      message: e.message
    }))
  }
}
```

---

## Code Style

### Function Components
Always use function components:
```typescript
// ✓ Good
export function MyComponent(props: MyComponentProps) {
  return <div>{props.children}</div>
}

// ✗ Avoid class components
class MyComponent extends Component { }
```

### Props Splitting
Use `splitProps` to separate controlled props:
```typescript
export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "children"])

  return (
    <button {...rest} class={getButtonClass(local.variant, local.size)}>
      {local.children}
    </button>
  )
}
```

### Named Exports
Prefer named exports:
```typescript
// ✓ Named exports
export function MyComponent() { }
export const MY_CONSTANT = "value"

// ✗ Default exports (except for pages)
export default function MyComponent() { }
```

### Conditional Rendering
Use Solid.js control flow components:
```tsx
// ✓ Solid.js components
<Show when={isVisible()}>
  <Content />
</Show>

<Switch>
  <Match when={status() === "loading"}>
    <Loading />
  </Match>
  <Match when={status() === "error"}>
    <Error />
  </Match>
</Switch>

<For each={items()}>
  {(item) => <Item data={item} />}
</For>

// ✗ Ternary operators (avoid for complex cases)
{isVisible() ? <Content /> : null}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `WorkspaceSidebar` |
| Functions | camelCase | `handleClick` |
| Variables | camelCase | `isLoading` |
| Constants | SCREAMING_SNAKE | `MAX_ITEMS` |
| Types/Interfaces | PascalCase | `FileActivityState` |
| Files | kebab-case | `workspace-sidebar.tsx` |
| CSS classes | kebab-case | `file-tree-item` |

### Comments
Add comments only where logic isn't self-evident:
```typescript
// ✓ Good - explains non-obvious logic
// Skip system files that start with dot
const filteredFiles = files.filter(f => !f.name.startsWith("."))

// ✗ Avoid obvious comments
// Set loading to true
setLoading(true)
```

### Accessibility
Include proper accessibility attributes:
```tsx
<button
  role="button"
  aria-label="Close dialog"
  aria-selected={isSelected()}
  tabIndex={0}
  onKeyDown={handleKeyDown}
>
```

---

## Best Practices Summary

1. **No prop mutation** - Always use setter functions
2. **Cleanup handlers** - Use `onCleanup` for subscriptions
3. **Defensive coding** - Use optional chaining and null checks
4. **Performance** - Use `createMemo` for expensive computations
5. **Type safety** - Leverage TypeScript's type system
6. **Consistent naming** - Follow established conventions
7. **Single responsibility** - Each component handles one concern
8. **Accessibility** - Include ARIA attributes
9. **Event cleanup** - Always unsubscribe from events
10. **Feature isolation** - Keep features in separate directories
