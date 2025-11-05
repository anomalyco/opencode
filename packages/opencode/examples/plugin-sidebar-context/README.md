# Context Panel Plugin - Proof of Concept

This plugin demonstrates how to reimplement sidebar sections using the new plugin UI system.

## The Plugin UI Canvas

**IMPORTANT:** This plugin uses the **Plugin UI Canvas** API to render UI components.

Plugins MUST use components from `src/plugin-ui/` - direct use of OpenTUI elements may not work due to renderer context issues.

### Usage

```tsx
import { VStack, HStack, Text, For, createSignal } from "../../src/plugin-ui"

// ✅ Use Canvas components
<VStack gap={1}>
  <Text fg="#00ff00">Works!</Text>
</VStack>

// ❌ Don't use raw OpenTUI elements
<box> {/* May not work! */}
  <text>Might fail</text>
</box>
```

### Loading

Plugins are loaded as `.tsx` files - no build required! Bun transpiles at runtime:

```json
{
  "plugin": ["file:///path/to/examples/plugin-sidebar-context/index.tsx"]
}
```

## What This Plugin Does

Reimplements the **Context** section from `sidebar.tsx` (lines 450-472) as a standalone plugin component.

### Original Sidebar Code (sidebar.tsx)

```tsx
<box>
  <text fg={theme.text} attributes={TextAttributes.BOLD}>
    Context
  </text>
  <ContextUsageBar
    currentTokens={context().tokens}
    tokenLimit={context().tokenLimit}
    systemTokens={context().systemTokens}
    assistantTokens={context().assistantTokens}
    userTokens={context().userTokens}
    toolTokens={context().toolTokens}
    agentColor={local.agent.color("assistant")}
    systemColor={theme.textMuted}
    assistantColor={theme.primary}
    toolColor={theme.accent}
    userColor={theme.secondary}
    backgroundColor={theme.backgroundPanel}
    width={40}
  />
  <text fg={theme.textMuted}>{context().tokensFormatted} tokens</text>
  <text fg={theme.textMuted}>{context().percentage}% used</text>
  <text fg={theme.textMuted}>{cost()} spent</text>
</box>
```

### Plugin Implementation

```tsx
// 1. Register panel with subscriptions
"ui.register": async (input, output) => {
  output.panels = [{
    id: "context-panel",
    label: "Context",
    area: "left",
    position: "top"
  }]

  // Subscribe to updates
  output.subscriptions = {
    events: ["session.updated", "context.updated"],
    session: true
  }
}

// 2. Render component with reactive data
"ui.render": async (input, output) => {
  const { client, sessionID } = input.context

  const ContextPanel = () => {
    const [context, setContext] = createSignal({...})

    onMount(() => {
      // Fetch context from API
      const fetchContext = async () => {
        const response = await client.sessions.retrieve({ path: { sessionID } })
        setContext(response.data.context)
      }
      fetchContext()
      setInterval(fetchContext, 2000) // Poll for updates
    })

    return <box>...</box>
  }

  output.component = <ContextPanel />
}

// 3. Handle events for refresh
"ui.event": async (input, output) => {
  if (input.event.type === "session.updated") {
    output.refresh = true // Trigger re-render
  }
}
```

## Key Features Demonstrated

### 1. Panel Registration

- Declares a panel that appears in the sidebar
- Specifies position, label, icon
- Works alongside existing sidebar sections

### 2. Data Subscriptions

- Subscribes to Bus events (`session.updated`, `context.updated`)
- Plugin automatically refreshes when relevant events fire
- No manual event wiring needed in sidebar code

### 3. SDK Client Access

- Plugin receives `OpencodeClient` in context
- Can fetch session data directly via `client.sessions.retrieve()`
- No need to pass data through props

### 4. Reactive UI

- Uses Solid.js signals for reactivity
- Polls for updates every 2 seconds
- Automatically re-renders when data changes

### 5. Event-Driven Refresh

- `ui.event` hook called when subscribed events fire
- Plugin can return `refresh: true` to trigger re-render
- Reduces unnecessary re-renders

## How to Use

### 1. Install the Plugin

Add to `opencode.json`:

```json
{
  "plugins": ["./examples/plugin-sidebar-context"]
}
```

### 2. Update Sidebar to Use Plugin Component

Replace the Context section in `sidebar.tsx`:

**Before:**

```tsx
<box>
  <text fg={theme.text} attributes={TextAttributes.BOLD}>
    Context
  </text>
  <ContextUsageBar ... />
  <text fg={theme.textMuted}>{context().tokensFormatted} tokens</text>
  ...
</box>
```

**After:**

```tsx
<PluginComponent
  componentId="context-panel"
  context={{ sessionID: props.sessionID, theme }}
  fallback="Loading context..."
/>
```

### 3. Run OpenCode

```bash
bun dev
```

The Context panel will now be rendered by the plugin instead of hardcoded sidebar code.

## Benefits Over Hardcoded Sidebar

### ✅ Modularity

- Context panel is self-contained
- Can be enabled/disabled via config
- Easy to swap implementations

### ✅ Reusability

- Same plugin can work in different UIs (TUI, desktop, web)
- Logic and UI bundled together
- No prop drilling

### ✅ Event-Driven

- Subscribes only to relevant events
- Automatic refresh when data changes
- Less coupling between components

### ✅ Extensibility

- Third-party developers can replace panels
- Plugin can be distributed independently
- No need to fork/modify sidebar.tsx

## Next Steps

This proof of concept demonstrates the plugin system works. Next sections to convert:

1. ✅ **Context Panel** (this plugin)
2. **Tab Navigation** (Tools/Todos/Files tabs)
3. **Tools Tab Content** (Tools used, LSP servers, MCP tools, Subagents)
4. **Todos Tab Content** (Todo list with status updates)
5. **Files Tab Content** (Modified files list)

Each section can become an independent plugin, making the sidebar a composition of plugins rather than a monolithic component.

## Architecture Notes

### Plugin → UI Data Flow

```
1. Plugin registers: "I need these events"
   └─> UIRegistry stores subscriptions

2. Bus event fires: "session.updated"
   └─> UIRegistry calls plugin's ui.event hook
       └─> Plugin returns { refresh: true }
           └─> UIExtensions.triggerComponentRefresh("context-panel")
               └─> PluginComponent refreshCounter increments
                   └─> createResource re-fetches
                       └─> UI re-renders

3. Plugin fetches data via SDK client
   └─> No prop drilling needed
   └─> Plugin controls its own data
```

### File Structure

```
examples/plugin-sidebar-context/
├── index.tsx          # Plugin implementation
├── package.json       # Plugin metadata
└── README.md          # This file
```

### Type Safety

The plugin uses TypeScript with `any` types for hooks to avoid complex type gymnastics. In production, you would:

```typescript
import type { UIHooks } from "@/ui/types"

"ui.register": async (
  input: Parameters<Required<UIHooks>["ui.register"]>[0],
  output: Parameters<Required<UIHooks>["ui.register"]>[1]
) => { ... }
```

## Comparison: Before vs After

| Aspect             | Hardcoded Sidebar                                 | Plugin System                         |
| ------------------ | ------------------------------------------------- | ------------------------------------- |
| **Lines of code**  | ~25 lines in sidebar.tsx                          | ~180 lines in plugin (self-contained) |
| **Dependencies**   | ContextUsageBar component, context(), theme, etc. | SDK client only                       |
| **Data flow**      | Props from parent                                 | Fetches directly via API              |
| **Event handling** | Manual useEffect/polling                          | Declarative subscriptions             |
| **Reusability**    | Sidebar-specific                                  | Works in any UI                       |
| **Extensibility**  | Fork sidebar.tsx                                  | Install/configure plugin              |
| **Testing**        | Test entire sidebar                               | Test plugin in isolation              |

## Performance Considerations

- **Polling**: Plugin polls every 2 seconds (same as original sidebar)
- **Event-driven refresh**: Only refreshes when subscribed events fire
- **SDK overhead**: Slightly higher due to API calls vs direct data access
- **Bundle size**: Plugin is lazy-loaded, not in main bundle

## Known Limitations

1. **No theming yet**: Colors are hardcoded, should use theme context
2. **No error UI**: Errors logged to console, not shown in UI
3. **Polling only**: Could use WebSocket subscriptions instead
4. **Bar rendering**: Simplified compared to ContextUsageBar component

These can be improved in future iterations while keeping the same plugin structure.
