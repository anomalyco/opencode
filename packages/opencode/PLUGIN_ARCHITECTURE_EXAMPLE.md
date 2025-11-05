# Plugin Architecture: Dynamic JSX Rendering

## The Problem

When plugins export JSX directly, it gets compiled at **module load time**, before the renderer context exists:

```typescript
// ❌ WRONG - JSX compiled too early
export const MyPlugin = async () => {
  return {
    "ui.render": async (input, output) => {
      output.component = <MyComponent />  // Compiled at module load!
    }
  }
}
```

## The Solution

Export the **component function**, not JSX. Let the host render it:

```typescript
// ✅ RIGHT - Component function returned
export const MyPlugin = async () => {
  return {
    "ui.render": async (input, output) => {
      const MyComponent = () => {
        return <box><text>Hello!</text></box>
      }
      output.component = MyComponent  // Function, not JSX
    }
  }
}
```

## Complete Working Example

### 1. Plugin File (my-plugin.tsx)

```typescript
/** @jsxImportSource @opentui/solid */

import { createSignal, onMount } from "solid-js"

export const MyDynamicPlugin = async () => {
  return {
    "ui.register": async (_input: any, output: any) => {
      output.panels = [{
        id: "my-panel",
        label: "My Panel",
        icon: "🚀",
        area: "left",
        position: "top",
      }]
    },

    "ui.render": async (input: any, output: any) => {
      if (input.componentId === "my-panel") {
        // Define component inside the hook
        const MyPanelComponent = () => {
          const [count, setCount] = createSignal(0)

          onMount(() => {
            const interval = setInterval(() => {
              setCount(c => c + 1)
            }, 1000)
            return () => clearInterval(interval)
          })

          // JSX is compiled when component renders, not at module load
          return (
            <box flexDirection="column" gap={1}>
              <text fg="#00ff00">Dynamic Plugin Panel</text>
              <text fg="#6b7280">Count: {count()}</text>
              <text fg="#6b7280">Context: {input.context.sessionID}</text>
            </box>
          )
        }

        // Return the FUNCTION, not JSX
        output.component = MyPanelComponent
        output.type = "component"
      }
    }
  }
}

export default MyDynamicPlugin
```

### 2. Host/Loader (PluginComponent.tsx)

```typescript
import { createSignal, Show, onMount, type Component } from "solid-js"
import { Plugin } from "@/plugin"

export function PluginComponent(props: { componentId: string, context?: any }) {
  const [ComponentFn, setComponentFn] = createSignal<Component | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  async function loadComponent() {
    try {
      const plugins = await Plugin.list()

      for (const plugin of plugins) {
        const uiRender = plugin["ui.render"]
        if (!uiRender) continue

        const output: any = {}
        await uiRender(
          {
            componentId: props.componentId,
            context: props.context,
          },
          output
        )

        if (output.component) {
          // Store the component FUNCTION
          setComponentFn(() => output.component)
          return
        }
      }

      setError(`No plugin can render: ${props.componentId}`)
    } catch (err) {
      setError(String(err))
    }
  }

  onMount(() => {
    loadComponent()
  })

  return (
    <Show when={!error()} fallback={<text fg="#ff0000">{error()}</text>}>
      <Show when={ComponentFn()}>
        {/* Call the component function HERE, in the render tree */}
        {(() => {
          const Component = ComponentFn()!
          return <Component />  // JSX compiled NOW, in renderer context
        })()}
      </Show>
    </Show>
  )
}
```

### 3. Usage in App

```typescript
// In your TUI sidebar or main view
<PluginComponent
  componentId="my-panel"
  context={{ sessionID: "session-123" }}
/>
```

## Key Patterns

### Pattern 1: Component Function (Simple)

```typescript
output.component = () => <box><text>Hello</text></box>
```

### Pattern 2: Named Component (Better for debugging)

```typescript
const MyComponent = () => <box><text>Hello</text></box>
output.component = MyComponent
```

### Pattern 3: Component with Props

```typescript
const MyComponent = (props: { value: string }) => (
  <box><text>{props.value}</text></box>
)
output.component = MyComponent
```

### Pattern 4: Factory Function (Dynamic context)

```typescript
output.component = () => {
  const value = input.context.dynamicValue
  return <box><text>{value}</text></box>
}
```

## Timeline Comparison

### ❌ Wrong (JSX at module load)

```
1. import plugin → JSX compiled → React.createElement called → Error: No renderer
2. plugin.ui.render() → returns pre-compiled element
3. Host renders → too late, already failed
```

### ✅ Right (Function returned)

```
1. import plugin → component function defined (JSX not compiled yet)
2. plugin.ui.render() → returns function
3. Host renders → calls function → JSX compiled NOW → Success!
```

## Common Mistakes

### Mistake 1: Returning JSX Element

```typescript
// ❌ Wrong
output.component = <MyComponent />
```

### Mistake 2: Calling Component Too Early

```typescript
// ❌ Wrong
const element = MyComponent()
output.component = element
```

### Mistake 3: Not Wrapping in Function

```typescript
// ❌ Wrong
output.component = <div>Static</div>
```

## The Rule

**Always return a function that WILL return JSX, not JSX itself.**

The host will call your function at render time, when the renderer context exists.
