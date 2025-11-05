import type {
  SidebarDefinition,
  TabDefinition,
  PanelDefinition,
  WidgetDefinition,
  KeybindDefinition,
  StatusItemDefinition,
  CommandDefinition,
  UIHooks,
} from "./types"
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
    commands: CommandDefinition[]
  }

  const state = Instance.state(async () => {
    const extensions: UIExtension[] = []

    const plugins = await Plugin.list()
    log.info("[DEBUG] Plugin.list() returned", { count: plugins.length, plugins })
    for (const plugin of plugins) {
      log.info("[DEBUG] Checking plugin for ui.register hook", {
        plugin,
        hasUiRegister: !!(plugin as any)["ui.register"],
        hooks: Object.keys(plugin),
      })
      const uiRegister = (plugin as any)["ui.register"] as UIHooks["ui.register"]
      if (!uiRegister) continue

      const output = {
        sidebars: [],
        panels: [],
        tabs: [],
        widgets: [],
        keybinds: [],
        statusItems: [],
        commands: [],
      }

      try {
        await uiRegister(
          {
            platform: "tui",
            version: "1.0.0",
          },
          output,
        )

        extensions.push({
          pluginId: "unknown", // TODO: get plugin ID from plugin system
          ...output,
        })

        log.info("registered UI extensions", {
          sidebars: output.sidebars.length,
          tabs: output.tabs.length,
          panels: output.panels.length,
          widgets: output.widgets.length,
          keybinds: output.keybinds.length,
        })
      } catch (error) {
        log.error("failed to register UI extensions", { error })
      }
    }

    return { extensions }
  })

  export async function getSidebars(): Promise<SidebarDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap((e) => e.sidebars)
  }

  export async function getTabs(parentId?: string): Promise<TabDefinition[]> {
    const { extensions } = await state()
    const tabs = extensions.flatMap((e) => e.tabs)
    return parentId ? tabs.filter((t) => t.parent === parentId) : tabs
  }

  export async function getPanels(): Promise<PanelDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap((e) => e.panels)
  }

  export async function getWidgets(): Promise<WidgetDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap((e) => e.widgets)
  }

  export async function getKeybinds(): Promise<KeybindDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap((e) => e.keybinds)
  }

  export async function getStatusItems(): Promise<StatusItemDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap((e) => e.statusItems)
  }

  export async function getCommands(): Promise<CommandDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap((e) => e.commands)
  }

  export async function getComponent(
    componentId: string,
  ): Promise<
    | SidebarDefinition
    | TabDefinition
    | PanelDefinition
    | WidgetDefinition
    | StatusItemDefinition
    | null
  > {
    const { extensions } = await state()
    for (const ext of extensions) {
      const sidebar = ext.sidebars.find((s) => s.id === componentId)
      if (sidebar) return sidebar

      const tab = ext.tabs.find((t) => t.id === componentId)
      if (tab) return tab

      const panel = ext.panels.find((p) => p.id === componentId)
      if (panel) return panel

      const widget = ext.widgets.find((w) => w.id === componentId)
      if (widget) return widget

      const statusItem = ext.statusItems.find((si) => si.id === componentId)
      if (statusItem) return statusItem
    }
    return null
  }

  export async function renderComponent(
    componentId: string,
    context: Record<string, any>,
  ): Promise<{
    content: string
    type: "text" | "markdown" | "ansi" | "html"
    error?: string
  }> {
    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      const uiRender = (plugin as any)["ui.render"] as UIHooks["ui.render"]
      if (!uiRender) continue

      const output: {
        content?: string
        type?: "text" | "markdown" | "ansi" | "html"
        props?: Record<string, any>
        hidden?: boolean
        error?: string
      } = {}

      try {
        await uiRender(
          {
            componentId,
            context,
          },
          output,
        )

        if (output.content) {
          return {
            content: output.content,
            type: output.type || "text",
            error: output.error,
          }
        }
      } catch (error) {
        log.error("failed to render component", { componentId, error })
        return {
          content: "",
          type: "text",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    return {
      content: `Component "${componentId}" not found`,
      type: "text",
      error: "Component not found",
    }
  }

  export async function refresh() {
    // Trigger re-evaluation by accessing state
    const { extensions } = await state()
    log.info("UI registry refreshed", { extensions: extensions.length })
  }
}
