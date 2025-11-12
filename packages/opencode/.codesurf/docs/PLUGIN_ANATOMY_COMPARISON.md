# Plugin Anatomy Comparison: Traditional vs UI Widgets

## Overview

OpenCode supports two types of plugins:
1. **Traditional Plugins** - Backend functionality (tools, commands, auth, hooks)
2. **UI Widget Plugins** - Visual components that render in the TUI

---

## A) Traditional Plugin (Non-UI)

### Example: Prefill Assistant Plugin
**Purpose**: Modify assistant message behavior (backend logic only)
**Location**: `packages/plugin-prefill-assistant/src/index.ts`
**Size**: ~200 lines

### Structure

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export interface PrefillConfig {
  enabled?: boolean
  contexts?: {
    jsonOutput?: string
    codeOnly?: string
    // ... more contexts
  }
}

export const PrefillAssistantPlugin: Plugin = async (input) => {
  return {
    // Hook into session.prompt to modify messages before sending
    "session.prompt": async (input, output) => {
      const config = input.config?.prefillAssistant || {}
      
      // Apply prefill logic
      if (shouldPrefillJson(input.parts)) {
        output.prefill = "{"
      }
      
      return output
    },
    
    // Optionally provide config hook
    "config": async (config) => {
      // Can access/modify global config
    }
  }
}

export default PrefillAssistantPlugin
```

### Key Characteristics

| Aspect | Details |
|--------|---------|
| **JSX Required** | ❌ No - pure TypeScript/JavaScript |
| **Imports** | Only `@opencode-ai/plugin` types |
| **Hooks** | Backend hooks: `session.prompt`, `tool`, `config`, `auth`, etc. |
| **Visual Output** | ❌ None - modifies behavior only |
| **Build Process** | Standard TS → JS compilation |
| **Loading** | Direct import, no JSX resolution needed |
| **Config** | Can read/write config via hooks |

### Available Traditional Hooks

```typescript
interface Plugin {
  // Session hooks
  "session.prompt"?: (input, output) => Promise<void>
  "session.command"?: (input, output) => Promise<void>
  
  // Tool hooks
  "tool"?: (input, output) => Promise<void>
  
  // Auth hooks
  "auth"?: (input, output) => Promise<void>
  
  // Config hooks
  "config"?: (config) => Promise<void>
  
  // Event hooks
  "event"?: (input) => Promise<void>
}
```

---

## B) UI Widget Plugin

### Example: Steering Questions Plugin
**Purpose**: Render interactive forms in message stream
**Location**: `packages/opencode/examples/plugin-steering-questions/index.tsx`
**Size**: ~430 lines

### Structure

```typescript
/** @jsxImportSource @opentui/solid */  // ⚠️ CRITICAL

import { createSignal, For, Show, createMemo } from "../../src/plugin-ui"

export const SteeringQuestionsPlugin = async () => {
  return {
    // Register widget for detection in message stream
    "ui.register": async (_input: any, output: any) => {
      output.messageWidgets = [
        {
          id: "steering-question",
          pattern: /<steering-question[^>]*>([\s\S]*?)<\/steering-question>/g,
          systemPrompt: `# Steering Questions
          
You can ask interactive questions with:

<steering-question id="unique-id">
{
  "title": "Question Title",
  "questions": [...]
}
</steering-question>`,
        }
      ]
    },
    
    // Render the widget when detected
    "ui.render": async (input: any, output: any) => {
      const { componentId, context } = input
      
      if (componentId === "steering-question") {
        const SteeringQuestionWidget = () => {
          const [answers, setAnswers] = createSignal({})
          const [submitted, setSubmitted] = createSignal(false)
          
          // Solid.js reactive component
          return (
            <box flexDirection="column">
              <text>{context.config.title}</text>
              <For each={context.config.questions}>
                {(question) => (
                  <box>
                    <text>{question.label}</text>
                    {/* Interactive elements */}
                  </box>
                )}
              </For>
              <text onMouseUp={handleSubmit}>Submit</text>
            </box>
          )
        }
        
        output.component = SteeringQuestionWidget
        output.type = "component"
      }
    }
  }
}

export default SteeringQuestionsPlugin
```

### Key Characteristics

| Aspect | Details |
|--------|---------|
| **JSX Required** | ✅ Yes - `/** @jsxImportSource @opentui/solid */` |
| **Imports** | `solid-js`, `@opentui/solid`, plugin-ui components |
| **Hooks** | UI hooks: `ui.register`, `ui.render` |
| **Visual Output** | ✅ Renders in TUI (sidebar or message stream) |
| **Build Process** | JSX transform required (currently problematic) |
| **Loading** | **Must load .tsx source** (not built .js) |
| **Config** | Receives config via `input.config` |

### Available UI Hooks

```typescript
interface UIPlugin {
  // Register UI components
  "ui.register"?: (input, output) => Promise<void> {
    output.messageWidgets = [...]  // Message stream widgets
    output.sidebars = [...]         // Sidebar panels
    output.panels = [...]           // Individual panels
    output.tabs = [...]             // Tab components
    output.widgets = [...]          // Generic widgets
    output.keybinds = [...]         // Keyboard shortcuts
    output.statusItems = [...]      // Status bar items
    output.commands = [...]         // Commands
  }
  
  // Render UI components
  "ui.render"?: (input, output) => Promise<void> {
    output.component = MyComponent
    output.type = "component"
  }
  
  // Handle UI events
  "ui.event"?: (input) => Promise<void>
}
```

---

## Side-by-Side Comparison

| Feature | Traditional Plugin | UI Widget Plugin |
|---------|-------------------|------------------|
| **Purpose** | Backend logic, data processing | Visual components, user interaction |
| **File Extension** | `.ts` or `.tsx` | `.tsx` (JSX required) |
| **JSX Pragma** | Not needed | **Required**: `/** @jsxImportSource @opentui/solid */` |
| **Imports** | Plugin types only | `solid-js`, `@opentui/solid`, plugin-ui |
| **Hooks** | `session.*`, `tool`, `auth`, `config` | `ui.register`, `ui.render`, `ui.event` |
| **Returns** | Data, modified config | Solid.js component |
| **Reactivity** | None | Solid.js signals/effects |
| **Build** | Simple TS compilation | JSX transform (use source .tsx) |
| **Loading** | Can load `.js` build | **Must load `.tsx` source** |
| **Size** | Small (~50-200 lines) | Medium-Large (200-500 lines) |
| **Testing** | Unit tests | Visual testing in TUI |

---

## Critical Differences

### 1. JSX Pragma Requirement

**Traditional Plugin**: ❌ Not needed
```typescript
// Just TypeScript
export const MyPlugin: Plugin = async (input) => {
  return {
    "session.prompt": async (input, output) => {
      // Logic here
    }
  }
}
```

**UI Widget Plugin**: ✅ **REQUIRED**
```typescript
/** @jsxImportSource @opentui/solid */  // ⚠️ MUST HAVE THIS

export const MyUIPlugin = async () => {
  return {
    "ui.render": async (input, output) => {
      const Component = () => <box>...</box>
      output.component = Component
    }
  }
}
```

### 2. Loading Method

**Traditional Plugin**:
```json
{
  "plugin": [
    "npm-package-name",
    "file:///path/to/plugin.ts",
    "file:///path/to/dist/plugin.js"  // ✅ All work
  ]
}
```

**UI Widget Plugin**:
```json
{
  "plugin": [
    "file:///path/to/plugin.tsx"        // ✅ MUST BE SOURCE
    // "file:///path/to/dist/plugin.js" // ❌ FAILS (jsxDEV import error)
  ]
}
```

### 3. Component Framework

**Traditional Plugin**: Framework-agnostic
- Pure functions
- Return data/config
- No reactivity

**UI Widget Plugin**: Solid.js-based
- Reactive components
- Signals and effects
- JSX syntax
- OpenTUI rendering

---

## Message Widget Specific Anatomy

Message widgets have an additional detection pattern:

```typescript
"ui.register": async (_input, output) => {
  output.messageWidgets = [
    {
      // Unique identifier
      id: "my-widget",
      
      // Regex pattern to detect widget tags in message text
      pattern: /<my-widget[^>]*>([\s\S]*?)<\/my-widget>/g,
      
      // System prompt to teach the model how to use it
      systemPrompt: `
# My Widget

Use this in your responses:

<my-widget id="unique">
{
  "config": "json"
}
</my-widget>
`,
      
      // Optional: Custom config extraction
      extractConfig: (match) => {
        // Parse match[1] and return config object
      }
    }
  ]
}
```

### Detection Flow

1. **Model generates response** with `<my-widget>` tag
2. **MessageWidgets.detect()** finds pattern matches
3. **MessageWidgets.splitText()** splits text into segments
4. **TextPart component** renders segments:
   - Text segments → markdown rendering
   - Widget segments → `<PluginComponent>` rendering
5. **PluginComponent** calls `ui.render` with `componentId="my-widget"`
6. **Plugin returns** Solid.js component
7. **Component renders** in message stream

---

## Best Practices

### For Traditional Plugins ✅
- Use `.ts` files
- Keep logic pure and testable
- Return early, avoid deep nesting
- Handle errors gracefully
- Document hooks used

### For UI Widget Plugins ✅
- **Always** include JSX pragma comment
- Use `.tsx` extension
- Import from `plugin-ui` for approved components
- Keep components small and focused
- Test with `widget_test` feature
- **Load source .tsx files** (not built .js)
- Add `bunfig.toml` for future builds

### Build Configuration 📦

If you need to build UI plugins:

**bunfig.toml**:
```toml
[build]
[build.jsx]
runtime = "automatic"
importSource = "solid-js"
```

**build.ts**:
```typescript
await build({
  entrypoints: ["index.tsx"],
  outdir: "dist",
  external: [
    "@opencode-ai/sdk",
    "@opentui/solid",
    "@opentui/core"
    // Bundle solid-js for standalone dist
  ]
})
```

**Current Issue**: Built files have `jsxDEV` import errors. **Solution**: Load source `.tsx` files.

---

## Testing

### Traditional Plugin
```bash
# Unit test
bun test plugin.test.ts

# Import test
bun -e "import('./plugin.ts').then(m => console.log(Object.keys(m)))"
```

### UI Widget Plugin
```bash
# Import test
bun -e "import('./plugin.tsx').then(m => console.log(Object.keys(m)))"

# Visual test in TUI
# 1. Add to opencode.json
# 2. Restart TUI
# 3. Trigger widget (send message with tag)
# 4. Or use widget_test feature
```

---

## Summary

| | Traditional | UI Widget |
|---|---|---|
| **Complexity** | Low | Medium-High |
| **Learning Curve** | TypeScript | TypeScript + Solid.js + JSX |
| **Use Cases** | Logic, data, auth | Forms, visualizations, interaction |
| **Build Status** | ✅ Stable | ⚠️ Use source files |
| **Production Ready** | ✅ Yes | ⚠️ Ship .tsx files |

**When to use Traditional**: Backend logic, auth, config, tools
**When to use UI Widget**: Interactive forms, visualizations, user input
