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
  position?: "top" | "bottom" // Where in the sidebar to render
  collapsible?: boolean
}

export interface WidgetDefinition {
  id: string
  label: string
  sidebarPosition?: "top" | "bottom" | "inline" // Where in sidebar to render
  position?: { x: number; y: number } // For floating widgets
  size?: { width: number; height: number }
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

export interface MessageWidgetDefinition {
  id: string
  pattern: RegExp
  extractConfig?: (match: RegExpMatchArray) => any
  systemPrompt?: string // Instructions for the model on how to use this widget
}

// Subscription configuration for UI plugins
export interface UISubscriptions {
  /**
   * Bus events to subscribe to (e.g., ["session.updated", "todo.updated"])
   */
  events?: string[]
  /**
   * Subscribe to session data changes
   */
  session?: boolean
  /**
   * Subscribe to sync data updates
   */
  sync?: boolean
}

// UI Plugin Hook Extensions
export interface UIHooks {
  /**
   * Register UI extensions (sidebars, tabs, panels, keybinds)
   * Plugins declare what data/events they need via subscriptions
   */
  "ui.register"?: (
    input: {
      platform: "tui" | "desktop"
      version: string
      client: any // OpencodeClient - plugins get SDK access
    },
    output: {
      sidebars?: SidebarDefinition[]
      panels?: PanelDefinition[]
      tabs?: TabDefinition[]
      widgets?: WidgetDefinition[]
      keybinds?: KeybindDefinition[]
      statusItems?: StatusItemDefinition[]
      commands?: CommandDefinition[]
      messageWidgets?: MessageWidgetDefinition[]
      subscriptions?: UISubscriptions
    },
  ) => Promise<void>
  /**
   * Render UI component content - Can return either text or JSX component
   * Plugins can fetch data via client as needed
   */
  "ui.render"?: (
    input: {
      componentId: string
      context: {
        sessionID?: string
        theme?: "dark" | "light"
        width?: number
        height?: number
        client: any // OpencodeClient for data fetching
        [key: string]: any
      }
    },
    output: {
      content?: string
      component?: any // JSX Element
      type?: "text" | "markdown" | "ansi" | "html" | "component"
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
  /**
   * Handle subscribed events
   * Called when events the plugin subscribed to are fired
   */
  "ui.event"?: (
    input: {
      componentId: string
      event: {
        type: string
        properties: any
      }
    },
    output: {
      refresh?: boolean // Should component re-render?
    },
  ) => Promise<void>
}
