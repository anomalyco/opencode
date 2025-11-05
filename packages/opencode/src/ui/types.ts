// UI Component Definitions
export interface SidebarDefinition {
  id: string
  label: string
  icon?: string
  position: "left" | "right"
  defaultOpen?: boolean
  keybind?: string
}

export interface TabDefinition {
  id: string
  label: string
  icon?: string
  parent: string
  badge?: () => Promise<number>
}

export interface PanelDefinition {
  id: string
  label: string
  icon?: string
  area: "top" | "bottom" | "left" | "right"
  collapsible?: boolean
}

export interface WidgetDefinition {
  id: string
  label: string
  position: { x: number; y: number }
  size: { width: number; height: number }
}

export interface KeybindDefinition {
  id: string
  keys: string
  command: string
  when?: string
}

export interface StatusItemDefinition {
  id: string
  priority: number
  alignment: "left" | "right"
}

export interface CommandDefinition {
  id: string
  label: string
  description?: string
}

// UI Plugin Hook Extensions
export interface UIHooks {
  /**
   * Register UI extensions (sidebars, tabs, panels, keybinds)
   */
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
    },
  ) => Promise<void>
  /**
   * Render UI component content
   */
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
      content?: string
      type?: "text" | "markdown" | "ansi" | "html"
      props?: Record<string, any>
      hidden?: boolean
      error?: string
    },
  ) => Promise<void>
  /**
   * Handle UI component actions
   */
  "ui.action"?: (
    input: {
      componentId: string
      action: string
      payload: any
    },
    output: {
      result?: any
      error?: string
    },
  ) => Promise<void>
}
