/**
 * Example UI Plugin for OpenCode
 *
 * Demonstrates how to:
 * - Register widgets in the sidebar
 * - Register panels
 * - Register keybinds
 * - Render dynamic content
 */

import type { Plugin } from "@opencode-ai/plugin"
import type {
  WidgetDefinition,
  PanelDefinition,
  KeybindDefinition,
  StatusItemDefinition,
  CommandDefinition,
} from "../../src/ui/types"

export const ExampleUIPlugin: Plugin = async (_ctx) => {
  // Track some simple state
  let counter = 0
  let lastSessionId: string | undefined

  return {
    // Register UI extensions
    "ui.register": async (
      input: { platform: "tui" | "desktop"; version: string },
      output: {
        widgets?: WidgetDefinition[]
        panels?: PanelDefinition[]
        keybinds?: KeybindDefinition[]
        statusItems?: StatusItemDefinition[]
        commands?: CommandDefinition[]
      },
    ) => {
      // Register a widget in the sidebar
      output.widgets = [
        {
          id: "example-counter-widget",
          label: "Counter Widget",
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
        },
      ]

      // Register a panel
      output.panels = [
        {
          id: "example-info-panel",
          label: "Example Info",
          area: "right",
          collapsible: true,
        },
      ]

      // Register a keybind
      output.keybinds = [
        {
          id: "example-increment",
          keys: "ctrl+shift+i",
          command: "example.increment",
          when: undefined,
        },
      ]

      // Register status items
      output.statusItems = [
        {
          id: "example-status",
          priority: 100,
          alignment: "right",
        },
      ]

      // Register commands
      output.commands = [
        {
          id: "example.increment",
          label: "Increment Counter",
          description: "Increments the example plugin counter",
        },
      ]
    },

    // Render UI component content
    "ui.render": async (
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
    ) => {
      const { componentId, context } = input

      // Store session ID for reference
      if (context.sessionID) {
        lastSessionId = context.sessionID
      }

      // Render different content based on component ID
      switch (componentId) {
        case "example-counter-widget":
          output.content = `
Counter: ${counter}
Press Ctrl+Shift+I to increment

Session: ${context.sessionID?.slice(0, 8) || "none"}
Theme: ${context.theme || "unknown"}
          `.trim()
          output.type = "text"
          break

        case "example-info-panel":
          output.content = `
=== Example Plugin Info ===

This is a demo plugin showing:
- Widget rendering
- Panel rendering
- Keybind registration
- Dynamic content

Last session: ${lastSessionId?.slice(0, 8) || "none"}
Counter value: ${counter}
          `.trim()
          output.type = "text"
          break

        case "example-status":
          output.content = `🔌 Counter: ${counter}`
          output.type = "text"
          break

        default:
          output.content = `Unknown component: ${componentId}`
          output.type = "text"
          output.error = "Component not found"
      }
    },

    // Handle UI actions (e.g., button clicks, command execution)
    "ui.action": async (
      input: {
        componentId: string
        action: string
        payload: any
      },
      output: {
        result?: any
        error?: string
      },
    ) => {
      const { componentId, action } = input

      switch (action) {
        case "increment":
          counter++
          output.result = { counter }
          break

        case "decrement":
          counter--
          output.result = { counter }
          break

        case "reset":
          counter = 0
          output.result = { counter }
          break

        default:
          output.error = `Unknown action: ${action}`
      }
    },

    // Listen to events
    event: async (input) => {
      // Example: Increment counter on certain events
      if (input.event.type === "session.created") {
        // Session created
      }
    },
  }
}

export default ExampleUIPlugin
