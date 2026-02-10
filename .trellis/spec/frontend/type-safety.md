# Type Safety

> TypeScript conventions, type patterns, and type organization in this project.

---

## Overview

This project uses **TypeScript** with **strict mode** enabled. All code must be fully typed with no `any` types (except where explicitly necessary and documented).

---

## TypeScript Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "target": "ESNext",
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "lib": ["es2023", "dom", "dom.iterable"]
  }
}
```

**Key settings**:
- `strict: true` - All strict type checking enabled
- `noEmit: true` - Type checking only, no compilation
- `jsx: "preserve"` - Preserve JSX for bundler

**Location**: `packages/ui/tsconfig.json`

---

## Type Naming Conventions

### Interface vs Type

**Use `interface` for**:
- Component props
- Object shapes
- Extendable types

```typescript
export interface ButtonProps {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
}
```

**Use `type` for**:
- Union types
- Intersection types
- Mapped types
- Function types

```typescript
type Size = "small" | "normal" | "large"
type Variant = "primary" | "secondary" | "ghost"
type Handler = (event: Event) => void
```

### Naming Patterns

| Pattern | Example | Usage |
|---------|---------|-------|
| `{Name}Props` | `ButtonProps` | Component props |
| `{Name}Options` | `AutoScrollOptions` | Hook/function options |
| `{Name}Fn` | `PermissionRespondFn` | Function type |
| `{Name}` | `Message`, `Session` | Data types |

---

## Component Props Types

### Basic Props Pattern

```typescript
export interface ButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconProps["name"]
}
```

**Key elements**:
1. Extend base component props
2. Pick specific HTML props
3. Add custom props
4. Use optional props with `?`

**Example**: `packages/ui/src/components/button.tsx`

### Props with Children

```typescript
import { ParentProps } from "solid-js"

export interface CardProps extends ParentProps<ComponentProps<"div">> {
  variant?: "normal" | "error" | "warning"
}
```

**Use `ParentProps`** when component accepts children

### Props with Generics

```typescript
export interface ListProps<T> {
  items: T[]
  renderItem: (item: T) => JSX.Element
}

export function List<T>(props: ListProps<T>) {
  return <For each={props.items}>{props.renderItem}</For>
}
```

---

## Type Inference

### Prefer Type Inference

```typescript
// Good - type inferred
const [count, setCount] = createSignal(0)

// Unnecessary - type is obvious
const [count, setCount] = createSignal<number>(0)
```

### Explicit Types When Needed

```typescript
// Good - type needed for empty array
const [items, setItems] = createSignal<string[]>([])

// Good - type needed for null initial value
const [data, setData] = createSignal<Data | null>(null)
```

---

## Union Types

### String Unions

```typescript
type Size = "small" | "normal" | "large"
type Variant = "primary" | "secondary" | "ghost"

export interface ButtonProps {
  size?: Size
  variant?: Variant
}
```

### Discriminated Unions

```typescript
type Result<T> =
  | { status: "success"; data: T }
  | { status: "error"; error: Error }
  | { status: "loading" }

function handleResult<T>(result: Result<T>) {
  switch (result.status) {
    case "success":
      return result.data  // Type: T
    case "error":
      return result.error  // Type: Error
    case "loading":
      return null
  }
}
```

---

## Type Guards

### Type Predicate Functions

```typescript
function isTextPart(part: Part): part is TextPart {
  return part.type === "text"
}

// Usage
const textParts = parts.filter(isTextPart)
// Type: TextPart[]
```

### Inline Type Guards

```typescript
const textParts = parts.filter((p): p is TextPart => p.type === "text")
```

**Example**: `packages/ui/src/components/message-part.tsx`

---

## Generic Types

### Generic Functions

```typescript
function identity<T>(value: T): T {
  return value
}

// Usage
const num = identity(42)        // Type: number
const str = identity("hello")   // Type: string
```

### Generic Components

```typescript
export interface ListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => JSX.Element
}

export function List<T>(props: ListProps<T>) {
  return (
    <For each={props.items}>
      {(item, index) => props.renderItem(item, index())}
    </For>
  )
}
```

### Constrained Generics

```typescript
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key]
}
```

---

## Utility Types

### Built-in Utility Types

```typescript
// Pick - Select properties
type ButtonSize = Pick<ButtonProps, "size">

// Omit - Exclude properties
type ButtonWithoutIcon = Omit<ButtonProps, "icon">

// Partial - Make all properties optional
type PartialButton = Partial<ButtonProps>

// Required - Make all properties required
type RequiredButton = Required<ButtonProps>

// Record - Object with specific key/value types
type ErrorMap = Record<string, string>

// ReturnType - Extract return type
type TimerID = ReturnType<typeof setTimeout>
```

### Custom Utility Types

```typescript
// Extract non-null type
type NonNullable<T> = T extends null | undefined ? never : T

// Extract array element type
type ArrayElement<T> = T extends (infer U)[] ? U : never
```

---

## Type Assertions

### Avoid Type Assertions

```typescript
// Bad - type assertion
const button = document.querySelector(".button") as HTMLButtonElement

// Good - type guard
const button = document.querySelector(".button")
if (button instanceof HTMLButtonElement) {
  // Use button
}
```

### When Type Assertions Are OK

```typescript
// OK - you know more than TypeScript
const icon = props.icon!  // Non-null assertion when you're sure

// OK - narrowing from unknown
const data = JSON.parse(str) as MyType
```

---

## Function Types

### Function Type Syntax

```typescript
// Type alias
type Handler = (event: Event) => void

// Interface
interface Handler {
  (event: Event): void
}

// Inline
const handler: (event: Event) => void = (event) => { ... }
```

### Callback Types

```typescript
export type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
}) => void

export type QuestionReplyFn = (input: {
  requestID: string
  answers: QuestionAnswer[]
}) => void
```

**Example**: `packages/ui/src/context/data.tsx`

---

## Type Organization

### Co-locate Types with Components

```typescript
// button.tsx
export interface ButtonProps { ... }
export function Button(props: ButtonProps) { ... }
```

### Shared Types in SDK

```typescript
// @opencode-ai/sdk/v2
export interface Message { ... }
export interface Session { ... }
export interface Part { ... }
```

### Type-only Imports

```typescript
import type { Message, Part } from "@opencode-ai/sdk/v2"
```

---

## SolidJS-Specific Types

### Component Types

```typescript
import { Component, ParentProps } from "solid-js"

// Component with props
export const Button: Component<ButtonProps> = (props) => { ... }

// Component with children
export const Card: Component<ParentProps<CardProps>> = (props) => { ... }
```

### JSX Types

```typescript
import { JSX } from "solid-js"

// JSX element
const element: JSX.Element = <div>Hello</div>

// Event handler
const handler: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (e) => { ... }
```

### Signal Types

```typescript
import { Signal, Accessor, Setter } from "solid-js"

// Signal tuple
const signal: Signal<number> = createSignal(0)

// Accessor
const count: Accessor<number> = () => 0

// Setter
const setCount: Setter<number> = (value) => { ... }
```

---

## Common Patterns

### Pattern 1: Optional Callback Props

```typescript
export interface ComponentProps {
  onClose?: () => void
  onChange?: (value: string) => void
}

// Usage
props.onClose?.()
props.onChange?.("value")
```

### Pattern 2: Ref Types

```typescript
let buttonRef: HTMLButtonElement | undefined

return <button ref={buttonRef}>Click</button>
```

### Pattern 3: Store Types

```typescript
import { Store, SetStoreFunction } from "solid-js/store"

const [store, setStore]: [
  Store<{ count: number }>,
  SetStoreFunction<{ count: number }>
] = createStore({ count: 0 })
```

---

## Anti-Patterns

### ❌ Don't

1. **Don't use `any`**
   ```typescript
   // Bad
   function getToolInfo(tool: string, input: any) { ... }

   // Good
   function getToolInfo(tool: string, input: Record<string, unknown>) { ... }
   ```

2. **Don't use type assertions unnecessarily**
   ```typescript
   // Bad
   const value = getValue() as string

   // Good
   const value = getValue()
   if (typeof value === "string") { ... }
   ```

3. **Don't ignore TypeScript errors**
   ```typescript
   // Bad
   // @ts-ignore
   const value = dangerousOperation()

   // Good - fix the type issue
   ```

4. **Don't use non-null assertions carelessly**
   ```typescript
   // Bad
   const value = maybeUndefined!.property

   // Good
   const value = maybeUndefined?.property
   ```

5. **Don't duplicate types**
   ```typescript
   // Bad - duplicate type definition
   interface ButtonProps { size: string }
   interface IconButtonProps { size: string }

   // Good - shared type
   type Size = "small" | "normal" | "large"
   interface ButtonProps { size?: Size }
   interface IconButtonProps { size?: Size }
   ```

6. **Don't confuse `??` with `||` for empty strings**
   ```typescript
   // Bad - empty string is not null/undefined, so ?? doesn't trigger
   const worktree = input.newSessionWorktree ?? "main"
   // If input.newSessionWorktree = "", result is "" (not "main")

   // Good - use || to handle all falsy values including empty strings
   const worktree = input.newSessionWorktree?.trim() || "main"
   // If input.newSessionWorktree = "", result is "main"
   ```

   **Why it matters**: The nullish coalescing operator `??` only checks for `null` or `undefined`, not empty strings. This can cause bugs when empty strings should be treated as "no value".

   **When to use each**:
   - Use `??` when you want to preserve falsy values like `0`, `false`, or `""`
   - Use `||` when you want to replace all falsy values (including `""`, `0`, `false`)

   **Real bug example**: In `submit.ts`, when `sync.data.path.directory` was an empty string, using `??` caused `sessionDirectory` to be set to `""`, triggering a validation error. The fix was to use `||` instead.

   **Files affected**:
   - `packages/app/src/components/prompt-input/submit.ts:169`
   - `packages/app/src/pages/session.tsx:591-599`

### ✅ Do

1. **Use strict mode**
   ```json
   { "strict": true }
   ```

2. **Export types with components**
   ```typescript
   export interface ButtonProps { ... }
   export function Button(props: ButtonProps) { ... }
   ```

3. **Use type inference**
   ```typescript
   const [count, setCount] = createSignal(0)  // Type inferred
   ```

4. **Use union types for variants**
   ```typescript
   type Variant = "primary" | "secondary" | "ghost"
   ```

5. **Use type guards**
   ```typescript
   if (part.type === "text") {
     // part is TextPart
   }
   ```

---

## Examples from Codebase

### Component Props
- `packages/ui/src/components/button.tsx`
- `packages/ui/src/components/card.tsx`
- `packages/ui/src/components/collapsible.tsx`

### Function Types
- `packages/ui/src/context/data.tsx` (callback types)

### Generic Types
- `packages/ui/src/hooks/use-filtered-list.tsx`

### Type Guards
- `packages/ui/src/components/message-part.tsx`

---

## Key Takeaways

1. **Strict mode** - Always enabled
2. **No `any`** - Use `unknown` or proper types
3. **Type inference** - Let TypeScript infer when possible
4. **Export types** - Export Props interfaces with components
5. **Union types** - Use for variants and states
6. **Type guards** - Use for narrowing types
7. **Generics** - Use for reusable components
8. **Co-locate** - Keep types with their components
9. **Type-only imports** - Use `import type` when possible
10. **Utility types** - Use built-in utility types
