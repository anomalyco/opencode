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

    const [extensions] = createResource(refreshCounter, async (): Promise<UIExtensions> => {
      try {
        // Debug: Log SDK client structure
        console.log("[UIExtensions] SDK client:", Object.keys(sdk.client))
        console.log("[UIExtensions] SDK client.ui:", sdk.client.ui)
        console.log("[UIExtensions] SDK client.ui.extensions:", (sdk.client as any).ui?.extensions)

        // Call the SDK to fetch UI extensions from plugins
        const result = await (sdk.client as any).ui.extensions()
        console.log("[UIExtensions] Received result:", result)
        return result
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
      content: string
      type: "text" | "markdown" | "ansi" | "html"
      error?: string
    }> {
      try {
        const result = await (sdk.client as any).ui.render(componentId, { context })
        return result
      } catch (error) {
        console.error(`Failed to render component ${componentId}:`, error)
        return {
          content: `Error rendering ${componentId}`,
          type: "text",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    function refresh() {
      setRefreshCounter((c) => c + 1)
    }

    return {
      extensions,
      renderComponent,
      refresh,
    }
  },
})
