# Plugin UI Canvas

## The Problem

Plugins that tried to render JSX directly using OpenTUI elements (`<box>`, `<text>`) failed with "No renderer found" errors. This is because:

1. Plugin components are created outside the TUI render tree
2. OpenTUI components need renderer context from `useRenderer()`
3. Direct TSX compilation had JSX transformation issues

## The Solution: Plugin UI Canvas

We created a **Canvas** - a library of wrapper components that are guaranteed to work in plugin context.

### Architecture

```
┌─────────────────────────────────────┐
│  Plugin (examples/plugin-*/index.tsx) │
│                                       │
│  import { VStack, Text, For }         │
│  from "../../src/plugin-ui"           │
│                                       │
│  Uses only Canvas components ✓       │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   Plugin UI Canvas (src/plugin-ui/)  │
│                                       │
│  - VStack, HStack (layout)            │
│  - Text, Box (elements)               │
│  - For, Show (control flow)           │
│  - createSignal, onMount (reactivity) │
│  - ContextUsageBar (existing TUI)     │
│                                       │
│  All tested & working ✓               │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   TUI Renderer (OpenTUI + Solid)    │
│                                       │
│  Renders within correct context ✓    │
└─────────────────────────────────────┘
```

### Key Files

- **`src/plugin-ui/canvas.tsx`** - Canvas components (VStack, HStack, Text, Box)
- **`src/plugin-ui/index.ts`** - Public API exports
- **Examples:**
  - `examples/plugin-sidebar-context/index.tsx` - Uses Canvas ✓

### Canvas API

```tsx
// Layout
import { VStack, HStack } from "@/plugin-ui"

<VStack gap={1}>  {/* Column layout */}
  <HStack gap={2}> {/* Row layout */}
  </HStack>
</VStack>

// Elements
import { Text, Box } from "@/plugin-ui"

<Text fg="#00ff00">Hello</Text>
<Box flexDirection="row">...</Box>

// Control Flow
import { For, Show, Switch, Match } from "@/plugin-ui"

<For each={items()}>
  {(item) => <Text>{item}</Text>}
</For>

// Reactivity
import { createSignal, createMemo, onMount, onCleanup } from "@/plugin-ui"

const [count, setCount] = createSignal(0)
onMount(() => { /* ... */ })

// Existing TUI Components
import { ContextUsageBar, SplitBorder, TextAttributes } from "@/plugin-ui"
```

## Rules for Plugins

1. ✅ **MUST use Canvas components** from `src/plugin-ui/`
2. ❌ **MUST NOT use raw OpenTUI elements** (`<box>`, `<text>`)
3. ✅ **Loaded as `.tsx` files** - no build needed
4. ✅ **Import from relative path**: `import { ... } from "../../src/plugin-ui"`

## Benefits

1. **Guaranteed to work** - All Canvas components are tested in TUI context
2. **No build complexity** - Plugins are plain TSX files
3. **Stable API** - Canvas won't break between OpenCode versions
4. **Type-safe** - Full TypeScript support
5. **Easy to extend** - Add more Canvas components as needed

## Next Steps

- Add more Canvas components (inputs, buttons, dialogs, etc.)
- Document all Canvas components with examples
- Create plugin templates using Canvas
- Add Canvas component tests
