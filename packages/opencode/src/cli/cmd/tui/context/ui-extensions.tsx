import { createResource, createSignal } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import type {
  SidebarDefinition,
  TabDefinition,
  PanelDefinition,
  WidgetDefinition,
  KeybindDefinition,
  StatusItemDefinition,
  CommandDefinition,
} from "@/ui/types"

export interface UIExtensions {
  sidebars: SidebarDefinition[]
  tabs: TabDefinition[]
  panels: PanelDefinition[]
  widgets: WidgetDefinition[]
  keybinds: KeybindDefinition[]
  statusItems: StatusItemDefinition[]
  commands: CommandDefinition[]
}

export const { use: useUIExtensions, provider: UIExtensionsProvider } = createSimpleContext({
  name: "UIExtensions",
  init: () => {
    const sdk = useSDK()
    const [refreshCounter, setRefreshCounter] = createSignal(0)

    // Map of componentId -> Set of callback functions
    const componentRefreshCallbacks = new Map<string, Set<() => void>>()

    // Map of componentId -> plugin instance (loaded from server)
    const pluginRegistry = new Map<string, any>()

    const [extensions] = createResource(refreshCounter, async (): Promise<UIExtensions> => {
      try {
        // Call the SDK to fetch UI extensions from plugins
        const result = await (sdk.client as any).ui.extensions()
        return (
          result?.data ?? {
            sidebars: [],
            tabs: [],
            panels: [],
            widgets: [],
            keybinds: [],
            statusItems: [],
            commands: [],
          }
        )
      } catch (error) {
        console.error("[UIExtensions] Failed to fetch UI extensions:", error)
        return {
          sidebars: [],
          tabs: [],
          panels: [],
          widgets: [],
          keybinds: [],
          statusItems: [],
          commands: [],
        }
      }
    })

    async function renderComponent(
      componentId: string,
      context: Record<string, any> = {},
    ): Promise<{
      content?: string
      component?: any
      type: "text" | "markdown" | "ansi" | "html" | "component"
      error?: string
    }> {
      try {
        const result = await (sdk.client as any).ui.render({
          path: { componentId },
          body: { context },
        })
        return result?.data ?? result
      } catch (error) {
        console.error(`[UIExtensions] Failed to render component ${componentId}:`, error)
        return {
          content: `Error rendering ${componentId}`,
          type: "text",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    function registerPlugin(componentId: string, plugin: any) {
      pluginRegistry.set(componentId, plugin)
    }

    function getPlugin(componentId: string): any | undefined {
      return pluginRegistry.get(componentId)
    }

    function subscribeToComponentRefresh(componentId: string, callback: () => void): () => void {
      if (!componentRefreshCallbacks.has(componentId)) {
        componentRefreshCallbacks.set(componentId, new Set())
      }
      componentRefreshCallbacks.get(componentId)!.add(callback)

      return () => {
        const callbacks = componentRefreshCallbacks.get(componentId)
        if (callbacks) {
          callbacks.delete(callback)
          if (callbacks.size === 0) {
            componentRefreshCallbacks.delete(componentId)
          }
        }
      }
    }

    function triggerComponentRefresh(componentId: string) {
      const callbacks = componentRefreshCallbacks.get(componentId)
      if (callbacks) {
        callbacks.forEach((cb) => cb())
      }
    }

    function refresh() {
      setRefreshCounter((c) => c + 1)
    }

    return {
      extensions,
      renderComponent,
      subscribeToComponentRefresh,
      triggerComponentRefresh,
      registerPlugin,
      getPlugin,
      refresh,
    }
  },
})
