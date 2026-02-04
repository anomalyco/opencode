# Frontend Directory Structure

> Module organization and file layout conventions for this project.

---

## Overview

This project uses **SolidJS** with a component-based architecture. The UI package (`packages/ui/`) contains all reusable UI components, hooks, and contexts.

---

## Directory Layout

```
packages/ui/src/
├── assets/              # Static assets
│   ├── audio/          # Sound files
│   ├── favicon/        # Favicon variants
│   ├── fonts/          # Custom fonts
│   ├── icons/          # SVG icons
│   └── images/         # Images
├── components/         # UI components
│   ├── file-icons/    # File type icons
│   └── provider-icons/ # Provider-specific icons
├── context/            # React/Solid contexts
├── hooks/              # Custom hooks
├── i18n/               # Internationalization
├── pierre/             # Diff rendering library
├── styles/             # Global styles
│   └── tailwind/      # Tailwind config
└── theme/              # Theme system
    └── themes/        # Theme definitions
```

---

## File Naming Conventions

### Components
- **Pattern**: `kebab-case.tsx` + `kebab-case.css`
- **Examples**:
  - `button.tsx` + `button.css`
  - `message-part.tsx` + `message-part.css`
  - `context-menu.tsx` + `context-menu.css`

### Hooks
- **Pattern**: `kebab-case.tsx` (or `.ts`)
- **Prefix**: `create-` for hook factories, `use-` for React-style hooks
- **Examples**:
  - `create-auto-scroll.tsx` - Hook factory
  - `use-filtered-list.tsx` - React-style hook

### Contexts
- **Pattern**: `kebab-case.tsx`
- **Examples**:
  - `data.tsx` - Data context
  - `dialog.tsx` - Dialog context
  - `i18n.tsx` - Internationalization context

---

## Component Organization

### Single Component per File
Each component gets its own file pair:
```
button.tsx       # Component logic
button.css       # Component styles
```

### Component with Subcomponents
Complex components with subcomponents use a single file:
```typescript
// accordion.tsx
export function Accordion() { ... }
export function AccordionItem() { ... }
export function AccordionHeader() { ... }
export function AccordionTrigger() { ... }
export function AccordionContent() { ... }
```

**Example**: `packages/ui/src/components/accordion.tsx`

### Component Exports
Components are exported directly (no default exports):
```typescript
export function Button(props: ButtonProps) { ... }
export interface ButtonProps { ... }
```

---

## Context Organization

### Context Pattern
Contexts use a helper pattern for creation:
```typescript
// packages/ui/src/context/data.tsx
export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props) => { ... }
})
```

### Context Index
All contexts are re-exported from `context/index.ts`:
```typescript
export * from "./helper"
export * from "./data"
export * from "./diff"
export * from "./dialog"
export * from "./i18n"
```

---

## Hook Organization

### Hook Files
Hooks are organized by functionality:
- `create-auto-scroll.tsx` - Auto-scroll behavior
- `use-filtered-list.tsx` - List filtering logic

### Hook Exports
Hooks export a single function:
```typescript
export function createAutoScroll(options: AutoScrollOptions) { ... }
```

---

## Asset Organization

### Icons
- **SVG icons**: `assets/icons/`
- **File type icons**: `components/file-icons/`
- **Provider icons**: `components/provider-icons/`

### Fonts
Custom fonts in `assets/fonts/` with proper licensing

### Images
Static images in `assets/images/`

---

## Style Organization

### Component Styles
Each component has a corresponding CSS file using CSS modules pattern:
```css
/* button.css */
[data-component="button"] {
  /* Base styles */
}

[data-component="button"][data-variant="primary"] {
  /* Variant styles */
}
```

### Global Styles
Global styles in `styles/` directory

### Tailwind
Tailwind configuration in `styles/tailwind/`

---

## Import Patterns

### Relative Imports
Use relative imports within the same package:
```typescript
import { Button } from "./button"
import { Icon } from "./icon"
import { useData } from "../context"
```

### Package Imports
Use package imports for cross-package dependencies:
```typescript
import { Message, Part } from "@opencode-ai/sdk/v2"
import { getFilename } from "@opencode-ai/util/path"
```

---

## Examples from Codebase

### Component File Structure
```
packages/ui/src/components/
├── button.tsx          # Button component
├── button.css          # Button styles
├── card.tsx            # Card component
├── card.css            # Card styles
├── message-part.tsx    # Complex component with subcomponents
└── message-part.css    # Message part styles
```

### Context File Structure
```
packages/ui/src/context/
├── index.ts            # Re-exports all contexts
├── data.tsx            # Data context
├── dialog.tsx          # Dialog context
└── i18n.tsx            # i18n context
```

### Hook File Structure
```
packages/ui/src/hooks/
├── index.ts                    # Re-exports all hooks
├── create-auto-scroll.tsx      # Auto-scroll hook
└── use-filtered-list.tsx       # Filtered list hook
```

---

## Anti-Patterns

### ❌ Don't
- Don't use default exports
- Don't mix multiple unrelated components in one file
- Don't use `index.tsx` for components (use named files)
- Don't nest component directories deeply

### ✅ Do
- Use named exports for all components
- Keep one component per file (unless subcomponents)
- Use `index.ts` only for re-exports
- Keep directory structure flat and organized by type

---

## Key Takeaways

1. **Flat structure** - Components, hooks, and contexts in separate directories
2. **Kebab-case naming** - All files use kebab-case
3. **Co-located styles** - Each component has a corresponding CSS file
4. **Named exports** - No default exports
5. **Type-safe** - TypeScript with strict mode enabled
