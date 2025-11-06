import type {
  SidebarDefinition,
  TabDefinition,
  PanelDefinition,
  WidgetDefinition,
  KeybindDefinition,
  StatusItemDefinition,
  CommandDefinition,
  MessageWidgetDefinition,
  UIHooks,
  UISubscriptions,
} from "./types"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { Server } from "../server/server"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { getCoreWidgetSystemPrompts } from "./renderers"

export namespace UIRegistry {
  const log = Log.create({ service: "ui-registry" })

  interface UIExtension {
    pluginId: string
    plugin: any // Store reference to plugin for event handling
    sidebars: SidebarDefinition[]
    panels: PanelDefinition[]
    tabs: TabDefinition[]
    widgets: WidgetDefinition[]
    keybinds: KeybindDefinition[]
    statusItems: StatusItemDefinition[]
    commands: CommandDefinition[]
    messageWidgets: MessageWidgetDefinition[]
    subscriptions?: UISubscriptions
  }

  const state = Instance.state(async () => {
    const extensions: UIExtension[] = []
    const appFetch = Server.App().fetch as any
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      fetch: appFetch,
    })

    const plugins = await Plugin.list()
    
    for (const plugin of plugins) {
      const uiRegister = (plugin as any)["ui.register"] as UIHooks["ui.register"]
      if (!uiRegister) continue

      const output: {
        sidebars?: SidebarDefinition[]
        panels?: PanelDefinition[]
        tabs?: TabDefinition[]
        widgets?: WidgetDefinition[]
        keybinds?: KeybindDefinition[]
        statusItems?: StatusItemDefinition[]
        commands?: CommandDefinition[]
        messageWidgets?: MessageWidgetDefinition[]
        subscriptions?: UISubscriptions
      } = {}

      try {
        await uiRegister(
          {
            platform: "tui",
            version: "1.0.0",
            client,
          },
          output,
        )

        await Bun.write("/tmp/opencode-widget-debug.log", `[${new Date().toISOString()}] Plugin registered messageWidgets: ${output.messageWidgets?.length || 0}\n`, { flags: "a" }).catch(() => {})
        
        extensions.push({
          pluginId: "unknown", // TODO: get plugin ID from plugin system
          plugin, // Store plugin reference for event handling
          sidebars: output.sidebars || [],
          panels: output.panels || [],
          tabs: output.tabs || [],
          widgets: output.widgets || [],
          keybinds: output.keybinds || [],
          statusItems: output.statusItems || [],
          commands: output.commands || [],
          messageWidgets: output.messageWidgets || [],
          subscriptions: output.subscriptions,
        })

        log.info("registered UI extensions", {
          sidebars: output.sidebars?.length || 0,
          tabs: output.tabs?.length || 0,
          panels: output.panels?.length || 0,
          widgets: output.widgets?.length || 0,
          keybinds: output.keybinds?.length || 0,
          messageWidgets: output.messageWidgets?.length || 0,
          subscriptions: output.subscriptions,
        })

        // Subscribe to events if plugin declared subscriptions
        if (output.subscriptions?.events) {
          for (const eventType of output.subscriptions.events) {
            Bus.subscribeAll(async (event) => {
              if (event.type === eventType) {
                await handlePluginEvent(plugin, event)
              }
            })
          }
        }
      } catch (error) {
        log.error("failed to register UI extensions", { error })
      }
    }

    return { extensions, client }
  })

  async function handlePluginEvent(plugin: any, event: any) {
    const uiEvent = (plugin as any)["ui.event"] as UIHooks["ui.event"]
    if (!uiEvent) return

    // TODO: Trigger refresh for components that need it
    // This would notify plugin-component.tsx to re-render
    log.info("plugin event triggered", { event: event.type })
  }

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

  export async function getMessageWidgets(): Promise<MessageWidgetDefinition[]> {
    const { extensions } = await state()
    return extensions.flatMap((e) => e.messageWidgets)
  }

  export async function getMessageWidgetSystemPrompts(): Promise<string[]> {
    const { extensions } = await state()
    const prompts: string[] = []
    
    // Add core widget system prompts
    prompts.push(...getCoreWidgetSystemPrompts())
    
    // Add plugin widget system prompts
    for (const ext of extensions) {
      for (const widget of ext.messageWidgets) {
        if (widget.systemPrompt) {
          prompts.push(widget.systemPrompt)
        }
      }
    }
    return prompts
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
    content?: string
    component?: any
    type: "text" | "markdown" | "ansi" | "html" | "component"
    error?: string
  }> {
    const { client } = await state()
    const plugins = await Plugin.list()
    log.info("rendering component", { componentId, pluginCount: plugins.length })

    for (const plugin of plugins) {
      const uiRender = (plugin as any)["ui.render"] as UIHooks["ui.render"]
      if (!uiRender) continue

      const output: {
        content?: string
        component?: any
        type?: "text" | "markdown" | "ansi" | "html" | "component"
        props?: Record<string, any>
        hidden?: boolean
        error?: string
      } = {}

      try {
        log.info("calling ui.render", { componentId })
        await uiRender(
          {
            componentId,
            context: {
              ...context,
              client,
            },
          },
          output,
        )

        log.info("ui.render result", {
          componentId,
          hasComponent: !!output.component,
          hasContent: !!output.content,
          type: output.type,
        })

        if (output.component) {
          return {
            component: output.component,
            type: "component",
            error: output.error,
          }
        }

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

    log.warn("component not found", { componentId })
    return {
      content: `Component "${componentId}" not found`,
      type: "text",
      error: "Component not found",
    }
  }

  export async function triggerAction(
    componentId: string,
    action: string,
    payload?: any,
  ): Promise<{
    result?: any
    error?: string
  }> {
    const plugins = await Plugin.list()
    log.info("triggering action", { componentId, action })

    for (const plugin of plugins) {
      const uiAction = (plugin as any)["ui.action"] as UIHooks["ui.action"]
      if (!uiAction) continue

      const output: {
        result?: any
        error?: string
      } = {}

      try {
        await uiAction(
          {
            componentId,
            action,
            payload,
          },
          output,
        )

        if (output.result !== undefined || output.error !== undefined) {
          log.info("action handled", { componentId, action, hasResult: !!output.result })
          return output
        }
      } catch (error) {
        log.error("failed to trigger action", { componentId, action, error })
        return {
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    log.warn("no plugin handled action", { componentId, action })
    return {
      error: `No plugin handled action "${action}" for component "${componentId}"`,
    }
  }

  export async function refresh() {
    // Trigger re-evaluation by accessing state
    const { extensions } = await state()
    log.info("UI registry refreshed", { extensions: extensions.length })
  }
}
