# Component Guidelines

> How components are built in this project.

---

## Overview

This project uses **SolidJS** with **Kobalte** (headless UI library) for accessible components. Components follow a consistent pattern with TypeScript interfaces, data attributes for styling, and composition patterns.

---

## Component Structure

### Basic Component Pattern

```typescript
// button.tsx
import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, splitProps } from "solid-js"
import { Icon, IconProps } from "./icon"

export interface ButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconProps["name"]
}

export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={split.icon}>
        <Icon name={split.icon!} size="small" />
      </Show>
      {props.children}
    </Kobalte>
  )
}
```

**Example**: `packages/ui/src/components/button.tsx`

### Key Elements

1. **Named exports** - No default exports
2. **Props interface** - Exported alongside component
3. **splitProps** - Separate local props from rest
4. **data attributes** - For styling hooks
5. **classList pattern** - For dynamic classes

---

## Props Conventions

### Props Interface Naming

```typescript
export interface ButtonProps { ... }
export interface CardProps { ... }
export interface IconButtonProps { ... }
```

**Pattern**: `{ComponentName}Props`

### Props Extension Patterns

#### Extend Kobalte Component

```typescript
export interface ButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  // Custom props
}
```

#### Extend HTML Element

```typescript
export interface CardProps extends ComponentProps<"div"> {
  variant?: "normal" | "error" | "warning" | "success" | "info"
}
```

#### Extend with ParentProps

```typescript
export interface CheckboxProps extends ParentProps<ComponentProps<typeof Kobalte>> {
  // Custom props
}
```

### Common Props

All components should support:

- `class?: string` - Single class name
- `classList?: Record<string, boolean>` - Conditional classes
- `children?: JSX.Element` - Child content (via ParentProps)

### Variant Props

Use string unions for variants:

```typescript
size?: "small" | "normal" | "large"
variant?: "primary" | "secondary" | "ghost"
```

**Default values**: Always provide defaults in the component

```typescript
data-size={split.size || "normal"}
data-variant={split.variant || "secondary"}
```

---

## Styling Patterns

### Data Attributes for Styling

Components use `data-*` attributes for CSS hooks:

```typescript
// Component
<Kobalte
  data-component="button"
  data-size={split.size || "normal"}
  data-variant={split.variant || "secondary"}
  {...rest}
/>
```

```css
/* button.css */
[data-component="button"] {
  /* Base styles */
}

[data-component="button"][data-size="small"] {
  /* Small size styles */
}

[data-component="button"][data-variant="primary"] {
  /* Primary variant styles */
}
```

### Data Attribute Conventions

- `data-component` - Component identifier (required)
- `data-variant` - Visual variant
- `data-size` - Size variant
- `data-slot` - Subcomponent identifier
- `data-state` - Dynamic state (active, disabled, etc.)

### classList Pattern

For dynamic classes:

```typescript
classList={{
  ...(split.classList ?? {}),
  [split.class ?? ""]: !!split.class,
}}
```

This allows both patterns:

```tsx
<Button class="my-class" />
<Button classList={{ "my-class": condition }} />
```

---

## Composition Patterns

### Compound Components

Use `Object.assign` for compound components:

```typescript
// collapsible.tsx
function CollapsibleRoot(props: CollapsibleProps) { ... }
function CollapsibleTrigger(props: ComponentProps<typeof Kobalte.Trigger>) { ... }
function CollapsibleContent(props: ComponentProps<typeof Kobalte.Content>) { ... }
function CollapsibleArrow(props?: ComponentProps<"div">) { ... }

export const Collapsible = Object.assign(CollapsibleRoot, {
  Arrow: CollapsibleArrow,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
})
```

**Usage**:

```tsx
<Collapsible open={open()} onOpenChange={setOpen}>
  <Collapsible.Trigger>
    <span>Click me</span>
    <Collapsible.Arrow />
  </Collapsible.Trigger>
  <Collapsible.Content>
    <p>Content here</p>
  </Collapsible.Content>
</Collapsible>
```

**Example**: `packages/ui/src/components/collapsible.tsx`

### Subcomponent Naming

Subcomponents use `data-slot` attribute:

```typescript
<Kobalte.Trigger data-slot="collapsible-trigger" {...props} />
<Kobalte.Content data-slot="collapsible-content" {...props} />
```

---

## Accessibility

### Kobalte Integration

This project uses **Kobalte** for accessible components:

- Built-in ARIA attributes
- Keyboard navigation
- Focus management
- Screen reader support

### Accessibility Requirements

1. **Use Kobalte primitives** when available
2. **Preserve ARIA attributes** from Kobalte
3. **Don't override accessibility props** unless necessary
4. **Test keyboard navigation** for interactive components

### Example: Accessible Button

```typescript
import { Button as Kobalte } from "@kobalte/core/button"

export function Button(props: ButtonProps) {
  return (
    <Kobalte
      {...rest}  // Preserves ARIA attributes
      data-component="button"
    >
      {props.children}
    </Kobalte>
  )
}
```

---

## Component Patterns

### Pattern 1: Simple Wrapper Component

Wraps a Kobalte component with custom styling:

```typescript
export function Card(props: CardProps) {
  const [split, rest] = splitProps(props, ["variant", "class", "classList"])
  return (
    <div
      {...rest}
      data-component="card"
      data-variant={split.variant || "normal"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.children}
    </div>
  )
}
```

**Example**: `packages/ui/src/components/card.tsx`

### Pattern 2: Icon Button

Component with required icon prop:

```typescript
export interface IconButtonProps extends ComponentProps<typeof Kobalte> {
  icon: IconProps["name"]  // Required
  size?: "normal" | "large"
  iconSize?: IconProps["size"]
  variant?: "primary" | "secondary" | "ghost"
}

export function IconButton(props: ComponentProps<"button"> & IconButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "iconSize", "class", "classList"])
  return (
    <Kobalte {...rest} data-component="icon-button">
      <Icon name={props.icon} size={split.iconSize ?? "small"} />
    </Kobalte>
  )
}
```

**Example**: `packages/ui/src/components/icon-button.tsx`

### Pattern 3: Compound Component

Component with subcomponents:

```typescript
export const Collapsible = Object.assign(CollapsibleRoot, {
  Arrow: CollapsibleArrow,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
})
```

**Example**: `packages/ui/src/components/collapsible.tsx`

---

## State Management in Components

### Local State with createSignal

```typescript
import { createSignal } from "solid-js"

export function MyComponent() {
  const [collapsed, setCollapsed] = createSignal(false)

  return (
    <button onClick={() => setCollapsed(!collapsed())}>
      Toggle
    </button>
  )
}
```

### Complex State with createStore

```typescript
import { createStore } from "solid-js/store"

export function MyComponent() {
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as string[],
    editing: false,
  })

  return <div>{/* Use store */}</div>
}
```

**Example**: `packages/ui/src/components/message-part.tsx` (QuestionPrompt)

---

## Common Mistakes

### ❌ Don't

1. **Don't use default exports**

   ```typescript
   // Bad
   export default function Button() { ... }
   ```

2. **Don't hardcode variant values**

   ```typescript
   // Bad
   <div data-variant="primary">

   // Good
   <div data-variant={split.variant || "secondary"}>
   ```

3. **Don't forget splitProps**

   ```typescript
   // Bad - passes all props including custom ones
   <Kobalte {...props} />

   // Good - separates custom props
   const [split, rest] = splitProps(props, ["variant", "size"])
   <Kobalte {...rest} />
   ```

4. **Don't override Kobalte accessibility**

   ```typescript
   // Bad
   <Kobalte role="button" aria-label="custom">

   // Good - let Kobalte handle it
   <Kobalte>
   ```

5. **Don't use inline styles**

   ```typescript
   // Bad
   <div style={{ color: "red" }}>

   // Good - use data attributes + CSS
   <div data-variant="error">
   ```

### ✅ Do

1. **Use named exports**

   ```typescript
   export function Button() { ... }
   export interface ButtonProps { ... }
   ```

2. **Use splitProps for prop separation**

   ```typescript
   const [split, rest] = splitProps(props, ["variant", "size"])
   ```

3. **Provide default values**

   ```typescript
   data-size={split.size || "normal"}
   ```

4. **Use data attributes for styling**

   ```typescript
   data-component="button"
   data-variant={variant}
   ```

5. **Export Props interfaces**

   ```typescript
   export interface ButtonProps { ... }
   ```

6. **Normalize external data before comparing**
   Some providers return tool/field names with different casing (e.g. `"Task"` vs `"task"`).
   Always normalize to lowercase before matching against internal registries or hardcoded strings.

   ```typescript
   // Good - normalize once, use everywhere
   function toolName(part: { tool: string }) {
     return part.tool.toLowerCase()
   }
   const tool = toolName(part)
   if (tool === "bash") { ... }

   // Bad - comparing raw external data against hardcoded lowercase
   if (part.tool === "bash") { ... }  // fails when part.tool is "Bash"
   ```

   **Lesson**: The ToolRegistry registers tools with lowercase names, but model providers
   may return uppercase tool names (e.g. `"Task"`, `"Bash"`, `"Question"`). This caused
   all tool renderers to silently fall back to `GenericTool`.

---

## Examples from Codebase

### Simple Component

- `packages/ui/src/components/card.tsx`
- `packages/ui/src/components/button.tsx`

### Icon Component

- `packages/ui/src/components/icon-button.tsx`

### Compound Component

- `packages/ui/src/components/collapsible.tsx`
- `packages/ui/src/components/accordion.tsx`

### Complex Component

- `packages/ui/src/components/message-part.tsx`

---

## Key Takeaways

1. **Kobalte-based** - Use Kobalte primitives for accessibility
2. **Data attributes** - Style via `data-*` attributes, not classes
3. **splitProps** - Always separate custom props from rest
4. **Named exports** - No default exports
5. **TypeScript** - Export Props interfaces
6. **Composition** - Use `Object.assign` for compound components
7. **Defaults** - Always provide default values for optional props
