# OpenCode UI Plugin System - Implementation Plan

**Status:** Planning Phase  
**Goal:** Enable plugins to customize and extend the OpenCode TUI/Desktop UI  
**Complexity:** High (requires architectural changes across TypeScript + Go/Stainless SDK)

---

## Executive Summary

Currently, OpenCode plugins can only modify **behavioral aspects** (tools, hooks, LLM interactions) but cannot customize the **UI layer**. This plan outlines a phased approach to expose UI extension points to plugins, enabling features like:

- Custom sidebars and panels
- New tabs and views
- UI components and widgets
- Keybind registration
- Theme customization
- Status bar extensions

---

## Current Architecture Analysis

### TUI Stack (Terminal UI)
- **Framework:** SolidJS + @opentui/solid (custom terminal renderer)
- **Location:** `packages/opencode/src/cli/cmd/tui/`
- **Components:** Dialog system, routes, contexts, UI primitives
- **Rendering:** Server-side SolidJS → terminal escape sequences

### Desktop Stack (Electron/Tauri)
- **Framework:** React/SolidJS + Vite
- **Location:** `packages/desktop/src/`
- **Components:** Sidebar, voice control, file tree, prompt input
- **Architecture:** Web-based with native shell

### Communication Layer
- **Server:** Hono REST API (`packages/opencode/src/server/server.ts`)
- **SDK:** Stainless-generated client (`packages/sdk/js/`)
- **Event Bus:** Internal pub/sub system (`packages/opencode/src/bus/`)
- **Real-time:** Server-Sent Events (SSE) for `/event` endpoint

### Current Plugin Capabilities
```typescript
interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: { provider, methods }
  "chat.message"?: ...
  "chat.params"?: ...
  "chat.messages"?: ...
  "permission.ask"?: ...
  "tool.execute.before"?: ...
  "tool.execute.after"?: ...
}
```

**Missing:** Any UI/visual hooks

---

## Proposed Architecture

### Phase 1: Server-Side UI Registry (Foundation)
**Goal:** Create infrastructure for plugins to register UI extensions  
**Timeline:** 2-3 weeks  
**Complexity:** Medium

#### 1.1 Create UI Plugin Hook Types
**File:** `packages/plugin/src/index.ts`

```typescript
export interface Hooks {
  // ... existing hooks ...
  
  // NEW: UI Extension hooks
  "ui.register"?: (
    input: { platform: "tui" | "desktop" },
    output: {
      sidebars?: SidebarDefinition[]
      panels?: PanelDefinition[]
      tabs?: TabDefinition[]
      widgets?: WidgetDefinition[]
      keybinds?: KeybindDefinition[]
      statusItems?: StatusItemDefinition[]
    }
  ) => Promise<void>
  
  "ui.render"?: (
    input: { 
      component: string  // ID of component being rendered
      context: any       // Current context (session, theme, etc)
    },
    output: {
      props?: Record<string, any>  // Modify props
      hidden?: boolean             // Hide component
    }
  ) => Promise<void>
}

// UI Component Definitions
interface SidebarDefinition {
  id: string
  label: string
  icon?: string
  position: "left" | "right"
  defaultOpen?: boolean
  renderUrl: string  // URL to fetch component content
  keybind?: string
}

interface TabDefinition {
  id: string
  label: string
  icon?: string
  parent: string  // Which sidebar/panel to add to
  renderUrl: string
  badge?: () => Promise<number>  // Dynamic badge count
}

interface PanelDefinition {
  id: string
  label: string
  icon?: string
  area: "top" | "bottom" | "left" | "right"
  renderUrl: string
  collapsible?: boolean
}

interface WidgetDefinition {
  id: string
  label: string
  renderUrl: string
  position: { x: number, y: number }
  size: { width: number, height: number }
}

interface KeybindDefinition {
  id: string
  keys: string  // e.g., "cmd+shift+x,ctrl+shift+x"
  command: string
  when?: string  // Condition expression
}

interface StatusItemDefinition {
  id: string
  priority: number
  renderUrl: string
  alignment: "left" | "right"
}
```

#### 1.2 UI Registry System
**File:** `packages/opencode/src/ui/registry.ts` (NEW)

```typescript
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

export namespace UIRegistry {
  const log = Log.create({ service: "ui-registry" })
  
  interface UIExtension {
    pluginId: string
    sidebars: SidebarDefinition[]
    panels: PanelDefinition[]
    tabs: TabDefinition[]
    widgets: WidgetDefinition[]
    keybinds: KeybindDefinition[]
    statusItems: StatusItemDefinition[]
  }
  
  const state = Instance.state(async () => {
    const extensions: UIExtension[] = []
    
    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      const uiRegister = plugin["ui.register"]
      if (!uiRegister) continue
      
      const output = {
        sidebars: [],
        panels: [],
        tabs: [],
        widgets: [],
        keybinds: [],
        statusItems: [],
      }
      
      await uiRegister(
        { platform: "tui" },  // or "desktop"
        output
      )
      
      extensions.push({
        pluginId: plugin.id,
        ...output,
      })
      
      log.info("registered UI extensions", { 
        plugin: plugin.id,
        sidebars: output.sidebars.length,
        tabs: output.tabs.length,
      })
    }
    
    return { extensions }
  })
  
  export async function getSidebars(): Promise<SidebarDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap(e => e.sidebars)
  }
  
  export async function getTabs(parentId: string): Promise<TabDefinition[]> {
    const { extensions } = await state()
    return extensions
      .flatMap(e => e.tabs)
      .filter(t => t.parent === parentId)
  }
  
  export async function getKeybinds(): Promise<KeybindDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap(e => e.keybinds)
  }
  
  // ... other getters
}
```

#### 1.3 Server API Endpoints
**File:** `packages/opencode/src/server/server.ts`

```typescript
// Add new endpoints:

app.openapi(
  route({
    method: "get",
    path: "/ui/extensions",
    description: "Get all registered UI extensions",
    operationId: "ui.extensions",
    responses: {
      200: {
        description: "List of UI extensions",
        content: {
          "application/json": {
            schema: z.object({
              sidebars: z.array(SidebarSchema),
              tabs: z.array(TabSchema),
              panels: z.array(PanelSchema),
              keybinds: z.array(KeybindSchema),
              widgets: z.array(WidgetSchema),
              statusItems: z.array(StatusItemSchema),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json({
      sidebars: await UIRegistry.getSidebars(),
      tabs: await UIRegistry.getTabs("*"),
      panels: await UIRegistry.getPanels(),
      keybinds: await UIRegistry.getKeybinds(),
      widgets: await UIRegistry.getWidgets(),
      statusItems: await UIRegistry.getStatusItems(),
    })
  }
)

app.openapi(
  route({
    method: "get",
    path: "/ui/render/:componentId",
    description: "Render a plugin UI component",
    operationId: "ui.render",
    // ... schema
  }),
  async (c) => {
    const { componentId } = c.req.valid("param")
    const component = await UIRegistry.getComponent(componentId)
    
    // Fetch component content from plugin's renderUrl
    const response = await fetch(component.renderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          sessionID: c.req.query("sessionID"),
          theme: c.req.query("theme"),
        },
      }),
    })
    
    const content = await response.text()
    return c.text(content, 200, {
      "Content-Type": "text/plain",
    })
  }
)
```

#### 1.4 SDK Regeneration
**Action Required:** Regenerate SDK to include new endpoints

```bash
cd packages/sdk/stainless
# Update stainless config to include /ui/* endpoints
# Regenerate client
npm run generate

# Results in new SDK methods:
# - client.ui.extensions()
# - client.ui.render(componentId)
```

---

### Phase 2: TUI Integration (Terminal UI)
**Goal:** Make TUI consume UI extensions from plugins  
**Timeline:** 3-4 weeks  
**Complexity:** High

#### 2.1 Dynamic Sidebar System
**File:** `packages/opencode/src/cli/cmd/tui/context/ui-extensions.tsx` (NEW)

```typescript
import { createContext, useContext, createResource, For } from "solid-js"
import { useSDK } from "./sdk"

interface UIExtensionsContext {
  sidebars: () => SidebarDefinition[]
  tabs: (parentId: string) => TabDefinition[]
  keybinds: () => KeybindDefinition[]
  refresh: () => void
}

const UIExtensionsContext = createContext<UIExtensionsContext>()

export function UIExtensionsProvider(props: { children: any }) {
  const sdk = useSDK()
  
  const [extensions, { refetch }] = createResource(async () => {
    return await sdk.ui.extensions()
  })
  
  const sidebars = () => extensions()?.sidebars ?? []
  const tabs = (parentId: string) => 
    extensions()?.tabs.filter(t => t.parent === parentId) ?? []
  const keybinds = () => extensions()?.keybinds ?? []
  
  return (
    <UIExtensionsContext.Provider 
      value={{ sidebars, tabs, keybinds, refresh: refetch }}
    >
      {props.children}
    </UIExtensionsContext.Provider>
  )
}

export function useUIExtensions() {
  return useContext(UIExtensionsContext)!
}
```

#### 2.2 Dynamic Component Renderer
**File:** `packages/opencode/src/cli/cmd/tui/component/plugin-component.tsx` (NEW)

```typescript
import { createResource, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { Box, Text } from "@opentui/solid"

interface PluginComponentProps {
  componentId: string
  context?: Record<string, any>
}

export function PluginComponent(props: PluginComponentProps) {
  const sdk = useSDK()
  
  const [content, { refetch }] = createResource(
    () => props.componentId,
    async (id) => {
      return await sdk.ui.render(id, {
        query: props.context,
      })
    }
  )
  
  return (
    <Show when={content()} fallback={<Text>Loading...</Text>}>
      <Box>
        {/* Render content as TUI elements */}
        <Text>{content()}</Text>
      </Box>
    </Show>
  )
}
```

#### 2.3 Modified App Layout
**File:** `packages/opencode/src/cli/cmd/tui/app.tsx`

```typescript
// Add UIExtensionsProvider to provider stack:

<UIExtensionsProvider>
  <ExitProvider onExit={onExit}>
    <KVProvider>
      {/* ... rest of providers ... */}
    </KVProvider>
  </ExitProvider>
</UIExtensionsProvider>
```

#### 2.4 Dynamic Sidebar Registration
**File:** `packages/opencode/src/cli/cmd/tui/routes/session.tsx`

```typescript
import { useUIExtensions } from "@tui/context/ui-extensions"

// In Session component:
const extensions = useUIExtensions()

// Render dynamic sidebars
<For each={extensions.sidebars()}>
  {(sidebar) => (
    <Sidebar
      id={sidebar.id}
      label={sidebar.label}
      icon={sidebar.icon}
      position={sidebar.position}
      keybind={sidebar.keybind}
    >
      <PluginComponent 
        componentId={sidebar.id}
        context={{ sessionID: props.sessionID }}
      />
    </Sidebar>
  )}
</For>
```

#### 2.5 Keybind System Enhancement
**File:** `packages/opencode/src/cli/cmd/tui/context/keybind.tsx`

```typescript
// Merge plugin keybinds with core keybinds
const extensions = useUIExtensions()
const pluginKeybinds = extensions.keybinds()

const allKeybinds = [
  ...coreKeybinds,
  ...pluginKeybinds.map(kb => ({
    key: kb.keys,
    handler: async () => {
      // Execute plugin command
      await Bus.publish(TuiEvent.CommandExecute, {
        command: kb.command,
      })
    },
    when: kb.when,
  })),
]
```

---

### Phase 3: Desktop Integration (Electron/Tauri)
**Goal:** Enable UI extensions in Desktop app  
**Timeline:** 2-3 weeks  
**Complexity:** Medium

#### 3.1 Desktop UI Extensions Context
**File:** `packages/desktop/src/context/ui-extensions.tsx` (NEW)

Similar to TUI implementation but using React hooks:

```typescript
import { createContext, useContext, useState, useEffect } from "react"
import { useSDK } from "./sdk"

interface UIExtensionsContext {
  sidebars: SidebarDefinition[]
  tabs: TabDefinition[]
  panels: PanelDefinition[]
  refresh: () => void
}

const UIExtensionsContext = createContext<UIExtensionsContext>(null!)

export function UIExtensionsProvider({ children }) {
  const sdk = useSDK()
  const [extensions, setExtensions] = useState(null)
  
  const loadExtensions = async () => {
    const data = await sdk.ui.extensions()
    setExtensions(data)
  }
  
  useEffect(() => {
    loadExtensions()
  }, [])
  
  return (
    <UIExtensionsContext.Provider 
      value={{
        sidebars: extensions?.sidebars ?? [],
        tabs: extensions?.tabs ?? [],
        panels: extensions?.panels ?? [],
        refresh: loadExtensions,
      }}
    >
      {children}
    </UIExtensionsContext.Provider>
  )
}
```

#### 3.2 Plugin Component Renderer
**File:** `packages/desktop/src/components/plugin-component.tsx` (NEW)

```typescript
import { useState, useEffect } from "react"
import { useSDK } from "@/context/sdk"

interface PluginComponentProps {
  componentId: string
  context?: Record<string, any>
}

export function PluginComponent({ componentId, context }: PluginComponentProps) {
  const sdk = useSDK()
  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const result = await sdk.ui.render(componentId, {
        query: context,
      })
      setContent(result)
      setLoading(false)
    }
    load()
  }, [componentId, context])
  
  if (loading) return <div>Loading...</div>
  
  // For MVP: render as HTML
  // For full solution: use iframe or Web Components
  return <div dangerouslySetInnerHTML={{ __html: content }} />
}
```

#### 3.3 Dynamic Sidebar System
**File:** `packages/desktop/src/components/sidebar.tsx`

Enhance existing sidebar to support plugins:

```typescript
import { useUIExtensions } from "@/context/ui-extensions"
import { PluginComponent } from "./plugin-component"

export function Sidebar() {
  const extensions = useUIExtensions()
  
  return (
    <div className="sidebar">
      {/* Core tabs */}
      <Tabs>
        <Tab id="files" label="Files" />
        <Tab id="todos" label="Todos" />
        
        {/* Plugin tabs */}
        {extensions.tabs.map(tab => (
          <Tab key={tab.id} id={tab.id} label={tab.label} icon={tab.icon}>
            <PluginComponent 
              componentId={tab.id}
              context={{ sessionID }}
            />
          </Tab>
        ))}
      </Tabs>
    </div>
  )
}
```

---

### Phase 4: Plugin Component Rendering (Advanced)
**Goal:** Allow plugins to provide actual UI components (not just URLs)  
**Timeline:** 4-6 weeks  
**Complexity:** Very High

#### 4.1 Component Hosting Strategy

**Option A: IFrame Isolation** (Recommended for MVP)
- Plugins serve HTML via their `renderUrl`
- TUI/Desktop renders in isolated iframe
- Pros: Security, sandboxing, independence
- Cons: Performance, communication overhead

**Option B: Web Components**
- Plugins register custom elements
- Loaded via `<plugin-component id="...">`
- Pros: Native, good performance
- Cons: Complexity, browser compatibility

**Option C: Dynamic Module Loading**
- Plugins export React/SolidJS components
- Hot-loaded via dynamic import
- Pros: Native framework support
- Cons: Security risks, dependency conflicts

#### 4.2 Implementation: IFrame Approach

**File:** `packages/opencode/src/cli/cmd/tui/component/plugin-iframe.tsx` (NEW)

```typescript
import { createSignal, onMount } from "solid-js"
import { Box } from "@opentui/solid"

export function PluginIFrame(props: { 
  src: string
  context: Record<string, any> 
}) {
  let iframeRef: HTMLIFrameElement
  const [ready, setReady] = createSignal(false)
  
  onMount(() => {
    // Post context to iframe when ready
    window.addEventListener("message", (event) => {
      if (event.data.type === "plugin-ready") {
        iframeRef.contentWindow?.postMessage({
          type: "context",
          data: props.context,
        }, "*")
        setReady(true)
      }
    })
  })
  
  return (
    <Box>
      <iframe
        ref={iframeRef}
        src={props.src}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
        }}
      />
    </Box>
  )
}
```

#### 4.3 Plugin SDK for Component Development
**File:** `packages/plugin/src/component.ts` (NEW)

```typescript
// Plugin authors use this to create UI components

export interface PluginComponentContext {
  sessionID: string
  theme: "dark" | "light"
  events: EventEmitter
}

export function createPluginComponent(
  render: (context: PluginComponentContext) => HTMLElement | string
) {
  // Listen for context from parent
  window.addEventListener("message", (event) => {
    if (event.data.type === "context") {
      const ctx: PluginComponentContext = {
        ...event.data.data,
        events: new EventEmitter(),
      }
      
      const result = render(ctx)
      
      if (typeof result === "string") {
        document.body.innerHTML = result
      } else {
        document.body.appendChild(result)
      }
    }
  })
  
  // Signal ready
  window.parent.postMessage({ type: "plugin-ready" }, "*")
}

// Example usage in plugin:
createPluginComponent((ctx) => {
  const div = document.createElement("div")
  div.textContent = `Session: ${ctx.sessionID}`
  div.style.color = ctx.theme === "dark" ? "white" : "black"
  return div
})
```

---

### Phase 5: Example Plugin Implementation
**Goal:** Demonstrate full capabilities with working example  
**Timeline:** 1 week  
**Complexity:** Medium

#### 5.1 Create Example Plugin Package
**File:** `packages/plugin-example-sidebar/src/index.ts` (NEW)

```typescript
import { Plugin } from "@opencode-ai/plugin"
import express from "express"

let app: express.Application

export const ExampleSidebarPlugin: Plugin = async (ctx) => {
  // Start mini HTTP server for component hosting
  app = express()
  app.use(express.json())
  
  // Serve UI component
  app.post("/render/sidebar", (req, res) => {
    const { sessionID, theme } = req.body.context
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: monospace; 
            padding: 1rem;
            background: ${theme === "dark" ? "#1e1e1e" : "#fff"};
            color: ${theme === "dark" ? "#fff" : "#000"};
          }
        </style>
      </head>
      <body>
        <h3>🔌 Plugin Sidebar</h3>
        <p>Session: ${sessionID}</p>
        <button onclick="alert('Plugin action!')">Do Something</button>
      </body>
      </html>
    `)
  })
  
  const server = app.listen(0)
  const port = (server.address() as any).port
  
  return {
    "ui.register": async (input, output) => {
      output.sidebars = [
        {
          id: "example-sidebar",
          label: "Example",
          icon: "puzzle",
          position: "right",
          renderUrl: `http://localhost:${port}/render/sidebar`,
          keybind: "cmd+e,ctrl+e",
        },
      ]
    },
    
    "ui.render": async (input, output) => {
      // Optionally modify rendering
    },
  }
}
```

#### 5.2 Example Plugin Configuration
**File:** User's `opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-example-sidebar@latest"
  ]
}
```

---

## Technical Challenges & Solutions

### Challenge 1: TUI Component Rendering
**Problem:** Terminal UI cannot render HTML/CSS  
**Solution:**
- Plugins return **text-based markup** for TUI (ANSI, custom DSL)
- Separate `renderUrl` for TUI vs Desktop
- Platform detection in `ui.register` hook

```typescript
"ui.register": async (input, output) => {
  if (input.platform === "tui") {
    output.sidebars = [{
      renderUrl: "http://localhost:3000/render/tui",  // Text output
    }]
  } else {
    output.sidebars = [{
      renderUrl: "http://localhost:3000/render/desktop",  // HTML output
    }]
  }
}
```

### Challenge 2: Plugin Lifecycle Management
**Problem:** When to start/stop plugin servers?  
**Solution:**
- Plugins start HTTP servers during initialization
- Use random ports (OS-assigned)
- Graceful shutdown via `plugin.destroy()` hook (NEW)

### Challenge 3: Security & Sandboxing
**Problem:** Plugins can inject malicious code  
**Solution:**
- IFrame sandbox attributes: `sandbox="allow-scripts"`
- Content Security Policy (CSP) headers
- Plugin approval/trust system
- Code signing for official plugins

### Challenge 4: State Management
**Problem:** Plugin components need to access OpenCode state  
**Solution:**
- Expose limited SDK via iframe `postMessage`
- Plugin components can call back to server
- Read-only access by default, write requires permission

```typescript
// In plugin component:
window.parent.postMessage({
  type: "opencode.api",
  method: "session.get",
  args: { sessionID: "abc123" },
}, "*")

// Parent responds:
window.postMessage({
  type: "opencode.api.response",
  data: { session: {...} },
}, "*")
```

### Challenge 5: Performance
**Problem:** Loading components from HTTP adds latency  
**Solution:**
- Cache rendered components
- Preload components on startup
- Lazy load on-demand
- Keep-alive HTTP connections

---

## Migration Path for CodeSurf Features

### Tool Favorites → Plugin
**Before:** Hardcoded in TUI  
**After:** `opencode-tool-favorites` plugin

```typescript
export const ToolFavoritesPlugin: Plugin = async (ctx) => {
  return {
    "ui.register": async (input, output) => {
      output.tabs = [{
        id: "tool-favorites",
        label: "Tools",
        parent: "right-sidebar",
        renderUrl: "http://localhost:PORT/render/favorites",
      }]
    },
    
    "tool.execute.after": async (input, output) => {
      // Track tool usage for favorites
    },
  }
}
```

### Quick Commit → Plugin
**Before:** Hardcoded in Files tab  
**After:** `opencode-quick-commit` plugin

```typescript
export const QuickCommitPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      "quick-commit": tool({
        description: "Commit selected files with AI-generated message",
        args: {
          files: tool.schema.array(tool.schema.string()),
        },
        async execute(args) {
          // Generate commit message
          // Stage files
          // Commit
        },
      }),
    },
    
    "ui.register": async (input, output) => {
      output.panels = [{
        id: "quick-commit-panel",
        label: "Quick Commit",
        area: "bottom",
        renderUrl: "http://localhost:PORT/render/commit",
      }]
    },
  }
}
```

---

## Rollout Plan

### Phase 1: Foundation (Weeks 1-3)
- [ ] Define UI plugin hook types
- [ ] Implement UIRegistry
- [ ] Add server API endpoints
- [ ] Regenerate SDK
- [ ] Write tests for registry

### Phase 2: TUI Integration (Weeks 4-7)
- [ ] Create UIExtensionsProvider
- [ ] Build PluginComponent renderer
- [ ] Update app layout
- [ ] Implement dynamic sidebars
- [ ] Enhance keybind system
- [ ] TUI testing

### Phase 3: Desktop Integration (Weeks 8-10)
- [ ] Desktop UIExtensionsProvider
- [ ] Desktop PluginComponent
- [ ] Update sidebar system
- [ ] Add panel support
- [ ] Desktop testing

### Phase 4: Advanced Rendering (Weeks 11-16)
- [ ] IFrame isolation system
- [ ] postMessage API bridge
- [ ] Plugin component SDK
- [ ] Security hardening
- [ ] Performance optimization

### Phase 5: Examples & Docs (Week 17)
- [ ] Create example-sidebar plugin
- [ ] Create tool-favorites plugin
- [ ] Create quick-commit plugin
- [ ] Write plugin development guide
- [ ] Update documentation

### Phase 6: Beta Testing (Weeks 18-20)
- [ ] Internal testing
- [ ] Community beta
- [ ] Bug fixes
- [ ] Performance tuning
- [ ] Security audit

### Phase 7: Production Release (Week 21+)
- [ ] Final testing
- [ ] Migration guide
- [ ] Official announcement
- [ ] Plugin marketplace setup

---

## Testing Strategy

### Unit Tests
- UIRegistry component registration
- Plugin hook triggering
- API endpoint responses
- SDK method calls

### Integration Tests
- Plugin loading flow
- Component rendering
- Keybind registration
- State management

### E2E Tests
- Install plugin → see sidebar
- Click plugin component → interact
- Plugin API calls work
- Uninstall plugin → cleanup

### Performance Tests
- Component load times
- Memory usage with multiple plugins
- HTTP request overhead
- Frame rate impact (Desktop)

---

## Documentation Required

### For Plugin Authors
1. **Plugin Development Guide**
   - UI hook reference
   - Component hosting setup
   - Example implementations
   - Best practices

2. **API Reference**
   - `ui.register` hook
   - `ui.render` hook
   - Component SDK methods
   - Event system

3. **Examples**
   - Minimal sidebar plugin
   - Complex dashboard plugin
   - Keybind plugin
   - Status bar plugin

### For Core Contributors
1. **Architecture Overview**
   - UIRegistry design
   - Component lifecycle
   - Security model
   - Testing approach

2. **Maintenance Guide**
   - Adding new UI areas
   - Breaking changes policy
   - Version compatibility

---

## Security Considerations

### Threats
1. **XSS Injection:** Malicious HTML in plugin components
2. **Data Exfiltration:** Plugin steals session data
3. **Resource Abuse:** Plugin consumes excessive memory/CPU
4. **Supply Chain:** Compromised plugin dependencies

### Mitigations
1. **Sandboxing:** IFrame with restrictive CSP
2. **Permission System:** Plugins request capabilities
3. **Resource Limits:** CPU/memory quotas per plugin
4. **Code Review:** Official plugins are audited
5. **Signing:** Cryptographic signatures for trusted plugins
6. **Runtime Monitoring:** Track plugin behavior

---

## Open Questions

1. **Should plugins be able to modify core UI components?**
   - Pro: More flexibility
   - Con: Risk of breaking changes

2. **What's the plugin distribution model?**
   - NPM packages (current)
   - Plugin marketplace
   - Git URLs
   - Local file paths

3. **How to handle plugin dependencies?**
   - Bundle everything (large size)
   - Shared dependencies (version conflicts)
   - Peer dependencies (complexity)

4. **Should we support plugin-to-plugin communication?**
   - Message bus for inter-plugin events
   - Shared state registry
   - API discovery

5. **What's the versioning strategy?**
   - Semantic versioning
   - Breaking changes to UI hooks
   - Deprecation policy

---

## Success Metrics

### Developer Experience
- Time to create first plugin: < 30 minutes
- API satisfaction: > 4.5/5
- Documentation clarity: > 4/5

### Technical Performance
- Component load time: < 200ms
- Memory overhead per plugin: < 50MB
- Frame rate impact: < 5%

### Adoption
- Community plugins created: > 20 in first 3 months
- Plugin installs: > 1000 in first 6 months
- Active users with plugins: > 30%

---

## Alternatives Considered

### Alternative 1: Full React/SolidJS Plugin Components
**Description:** Plugins export actual framework components  
**Pros:** Native feel, best performance  
**Cons:** Dependency hell, version conflicts, security risks  
**Decision:** Rejected due to complexity

### Alternative 2: DSL for UI Definition
**Description:** JSON/YAML UI definition language  
**Pros:** Simple, safe, cross-platform  
**Cons:** Limited flexibility, learning curve  
**Decision:** Could be Phase 2 addition

### Alternative 3: WebView API (Like VS Code)
**Description:** Each plugin gets embedded browser  
**Pros:** Full flexibility, proven model  
**Cons:** Heavy memory usage, complex  
**Decision:** Good inspiration, but adapted for our architecture

---

## References

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Obsidian Plugin Development](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Figma Plugin API](https://www.figma.com/plugin-docs/)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Web Components Spec](https://developer.mozilla.org/en-US/docs/Web/Web_Components)

---

## Appendix: Full Type Definitions

```typescript
// Complete type definitions for UI plugin system
// See packages/plugin/src/ui-types.ts

export interface UIPluginHooks {
  "ui.register"?: (
    input: {
      platform: "tui" | "desktop"
      version: string
    },
    output: {
      sidebars?: SidebarDefinition[]
      panels?: PanelDefinition[]
      tabs?: TabDefinition[]
      widgets?: WidgetDefinition[]
      keybinds?: KeybindDefinition[]
      statusItems?: StatusItemDefinition[]
      commands?: CommandDefinition[]
    }
  ) => Promise<void>
  
  "ui.render"?: (
    input: {
      componentId: string
      context: {
        sessionID?: string
        theme?: "dark" | "light"
        width?: number
        height?: number
        [key: string]: any
      }
    },
    output: {
      props?: Record<string, any>
      hidden?: boolean
      error?: string
    }
  ) => Promise<void>
  
  "ui.action"?: (
    input: {
      componentId: string
      action: string
      payload: any
    },
    output: {
      result?: any
      error?: string
    }
  ) => Promise<void>
}

// ... (full definitions)
```

---

**Next Steps:**
1. Review this plan with core team
2. Get feedback on architecture decisions
3. Prioritize phases based on user demand
4. Start Phase 1 implementation

**Questions/Feedback:** Open a GitHub discussion or issue

