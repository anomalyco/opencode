# Quality Guidelines

> Code standards, linting, testing, and best practices for this project.

---

## Overview

This project maintains high code quality through TypeScript strict mode, consistent patterns, and careful code review. Quality is enforced through type checking and code conventions.

---

## Code Quality Standards

### TypeScript Strict Mode

**Required**: All code must pass TypeScript strict mode checks.

```bash
bun run typecheck
```

**Configuration**: `tsconfig.json` with `"strict": true`

### No Lint Errors

While the project doesn't have a dedicated lint script configured, code should follow these standards:
- No unused variables
- No unused imports
- Consistent formatting
- Proper error handling

---

## Code Style

### Formatting

**Prettier Configuration** (from `package.json`):
```json
{
  "semi": false,
  "printWidth": 120
}
```

**Key rules**:
- No semicolons
- 120 character line width
- 2 space indentation (default)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `Button`, `MessagePart` |
| Files | kebab-case | `button.tsx`, `message-part.tsx` |
| Functions | camelCase | `createAutoScroll`, `handleClick` |
| Hooks | `create*` or `use*` | `createSignal`, `useData` |
| Types/Interfaces | PascalCase | `ButtonProps`, `Message` |
| Constants | UPPER_SNAKE_CASE | `TEXT_RENDER_THROTTLE_MS` |

**Example**: Throughout `packages/ui/src/`

---

## Forbidden Patterns

### ❌ Never Use

1. **`any` type**
   ```typescript
   // Bad
   function process(data: any) { ... }

   // Good
   function process(data: Record<string, unknown>) { ... }
   ```

   **Exception**: Existing code in `packages/ui/src/components/message-part.tsx:185` has one `any` for tool input - this is legacy code.

2. **`console.log` in production**
   ```typescript
   // Bad
   console.log("Debug info")

   // Good - use proper logging
   // (No logger configured yet, but avoid console.log)
   ```

3. **Non-null assertions without justification**
   ```typescript
   // Bad
   const value = maybeUndefined!.property

   // Good
   const value = maybeUndefined?.property
   ```

4. **Default exports**
   ```typescript
   // Bad
   export default function Button() { ... }

   // Good
   export function Button() { ... }
   ```

5. **Inline styles**
   ```typescript
   // Bad
   <div style={{ color: "red" }}>

   // Good - use data attributes + CSS
   <div data-variant="error">
   ```

6. **Mutating state directly**
   ```typescript
   // Bad
   store.items.push(newItem)

   // Good
   setStore("items", [...store.items, newItem])
   ```

---

## Best Practices

### Component Design

1. **Keep components focused**
   - One responsibility per component
   - Extract complex logic to hooks
   - Use composition over inheritance

2. **Use data attributes for styling**
   ```typescript
   <div data-component="button" data-variant="primary">
   ```

3. **Export Props interfaces**
   ```typescript
   export interface ButtonProps { ... }
   export function Button(props: ButtonProps) { ... }
   ```

4. **Use splitProps**
   ```typescript
   const [split, rest] = splitProps(props, ["variant", "size"])
   ```

### State Management

1. **Keep state local when possible**
   - Use `createSignal` for simple state
   - Use `createStore` for complex state
   - Only use context for shared state

2. **Use createMemo for derived values**
   ```typescript
   const doubled = createMemo(() => count() * 2)
   ```

3. **Always cleanup effects**
   ```typescript
   createEffect(() => {
     const timer = setTimeout(() => { ... }, 1000)
     onCleanup(() => clearTimeout(timer))
   })
   ```

### Type Safety

1. **Prefer type inference**
   ```typescript
   const [count, setCount] = createSignal(0)  // Type inferred
   ```

2. **Use union types for variants**
   ```typescript
   type Variant = "primary" | "secondary" | "ghost"
   ```

3. **Use type guards**
   ```typescript
   if (part.type === "text") {
     // part is TextPart
   }
   ```

---

## Code Organization

### File Structure

```typescript
// 1. Imports
import { createSignal } from "solid-js"
import { Button } from "./button"

// 2. Types/Interfaces
export interface MyComponentProps {
  title: string
}

// 3. Constants
const MAX_ITEMS = 100

// 4. Helper functions
function formatTitle(title: string) {
  return title.toUpperCase()
}

// 5. Component
export function MyComponent(props: MyComponentProps) {
  // Local state
  const [count, setCount] = createSignal(0)

  // Derived values
  const formattedTitle = () => formatTitle(props.title)

  // Effects
  createEffect(() => {
    // Effect logic
  })

  // Event handlers
  const handleClick = () => {
    setCount(count() + 1)
  }

  // Render
  return <div>{/* JSX */}</div>
}
```

### Import Order

1. External libraries (solid-js, etc.)
2. Internal packages (@opencode-ai/*)
3. Relative imports (./button, ../context)

```typescript
// External
import { createSignal } from "solid-js"
import { Button as Kobalte } from "@kobalte/core/button"

// Internal packages
import { Message } from "@opencode-ai/sdk/v2"
import { getFilename } from "@opencode-ai/util/path"

// Relative
import { Icon } from "./icon"
import { useData } from "../context"
```

---

## Error Handling

### Avoid try/catch Where Possible

From `AGENTS.md`:
> Avoid `try`/`catch` where possible

**Prefer**:
- Type guards
- Optional chaining
- Nullish coalescing

```typescript
// Good
const value = data?.property ?? defaultValue

// Avoid unless necessary
try {
  const value = riskyOperation()
} catch (error) {
  // Handle error
}
```

### When try/catch is Necessary

Use for:
- Async operations
- External API calls
- JSON parsing

```typescript
const fetchData = async () => {
  try {
    const response = await fetch("/api/data")
    return await response.json()
  } catch (error) {
    console.error("Failed to fetch data:", error)
    return null
  }
}
```

---

## Performance

### Avoid Over-Engineering

From `AGENTS.md`:
> Avoid over-engineering. Only make changes that are directly requested or clearly necessary.

**Don't**:
- Add features not requested
- Refactor code unnecessarily
- Add abstractions for one-time operations
- Design for hypothetical future requirements

**Do**:
- Keep solutions simple and focused
- Only add complexity when needed
- Inline one-time operations
- Solve current problems, not future ones

### Memoization

Use `createMemo` for expensive computations:

```typescript
// Expensive computation
const filtered = createMemo(() =>
  items().filter(item => item.active)
)

// Simple computation - no memo needed
const count = () => items().length
```

### Throttling

For high-frequency updates:

```typescript
const TEXT_RENDER_THROTTLE_MS = 100

function createThrottledValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let last = 0

  createEffect(() => {
    const next = getValue()
    const now = Date.now()
    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last)

    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      last = now
      setValue(next)
      return
    }

    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
      timeout = undefined
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  return value
}
```

**Example**: `packages/ui/src/components/message-part.tsx`

---

## Accessibility

### Use Kobalte Primitives

This project uses **Kobalte** for accessible components:
- Built-in ARIA attributes
- Keyboard navigation
- Focus management
- Screen reader support

**Always**:
- Use Kobalte primitives when available
- Preserve ARIA attributes from Kobalte
- Don't override accessibility props
- Test keyboard navigation

**Example**: All components in `packages/ui/src/components/`

---

## Testing

### Current State

The project doesn't have a comprehensive test suite configured yet.

### Testing Philosophy

From `AGENTS.md`:
> - Avoid mocks as much as possible
> - Test actual implementation, do not duplicate logic into tests

**When tests are added**:
- Test behavior, not implementation
- Use real components, not mocks
- Focus on user interactions
- Test edge cases

---

## Code Review Checklist

Before submitting code:

- [ ] TypeScript strict mode passes (`bun run typecheck`)
- [ ] No `any` types (except documented exceptions)
- [ ] No `console.log` statements
- [ ] No unused variables or imports
- [ ] Props interfaces exported
- [ ] Data attributes used for styling
- [ ] Named exports (no default exports)
- [ ] Proper cleanup in effects
- [ ] Type inference used where possible
- [ ] Code follows project conventions

---

## Common Mistakes

### Mistake 1: Forgetting to Call Signals

```typescript
// Bad
if (count > 5) { ... }

// Good
if (count() > 5) { ... }
```

### Mistake 2: Mutating State

```typescript
// Bad
store.items.push(newItem)

// Good
setStore("items", [...store.items, newItem])
```

### Mistake 3: Using createEffect for Derived Values

```typescript
// Bad
const [doubled, setDoubled] = createSignal(0)
createEffect(() => setDoubled(count() * 2))

// Good
const doubled = createMemo(() => count() * 2)
```

### Mistake 4: Forgetting splitProps

```typescript
// Bad - passes all props including custom ones
<Kobalte {...props} />

// Good - separates custom props
const [split, rest] = splitProps(props, ["variant", "size"])
<Kobalte {...rest} />
```

### Mistake 5: Hardcoding Variant Values

```typescript
// Bad
<div data-variant="primary">

// Good
<div data-variant={split.variant || "secondary"}>
```

---

## Project-Specific Guidelines

### From AGENTS.md

1. **Keep things in one function** unless composable or reusable
2. **Avoid `try`/`catch`** where possible
3. **Avoid using the `any` type**
4. **Prefer single word variable names** where possible
5. **Use Bun APIs** when possible
6. **Rely on type inference** - avoid explicit type annotations unless necessary
7. **Prefer functional array methods** (flatMap, filter, map) over for loops

### Variable Naming

From `AGENTS.md`:
```typescript
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

### Inline When Used Once

From `AGENTS.md`:
```typescript
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Avoid Unnecessary Destructuring

From `AGENTS.md`:
```typescript
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

---

## Tools and Commands

### Type Checking

```bash
bun run typecheck
```

Runs TypeScript type checking across all packages.

### Build

```bash
bun run --cwd packages/ui build
```

Builds the UI package.

---

## Examples from Codebase

### Well-Structured Components
- `packages/ui/src/components/button.tsx` - Simple component
- `packages/ui/src/components/card.tsx` - Minimal component
- `packages/ui/src/components/collapsible.tsx` - Compound component

### Complex Components
- `packages/ui/src/components/message-part.tsx` - Multiple patterns

### Custom Hooks
- `packages/ui/src/hooks/create-auto-scroll.tsx` - Hook factory

### Contexts
- `packages/ui/src/context/data.tsx` - Context pattern

---

## Key Takeaways

1. **TypeScript strict mode** - Always enabled, always passing
2. **No `any`** - Use proper types
3. **No default exports** - Use named exports
4. **Data attributes** - For styling, not classes
5. **splitProps** - Always separate custom props
6. **Cleanup effects** - Always use onCleanup
7. **Type inference** - Let TypeScript infer
8. **Keep it simple** - Avoid over-engineering
9. **Kobalte** - Use for accessibility
10. **Follow conventions** - Consistency matters

---

## Continuous Improvement

As the project evolves:
- Document new patterns discovered
- Update anti-patterns when bugs are found
- Add examples from real code
- Keep guidelines practical and actionable

**Remember**: These guidelines exist to help write consistent, maintainable code. When in doubt, look at existing code for examples.
