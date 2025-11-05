/**
 * Demo Tabbed Plugin for OpenCode
 *
 * Demonstrates a tabbed interface with multiple demo panels
 * Shows how plugins can create their own tab systems
 */

import type { PanelDefinition } from "../../src/ui/types"

export const DemoTabsPlugin = async (_ctx: any) => {
  let activeTab: "demo1" | "demo2" | "demo3" = "demo1"
  let counter = 0

  return {
    "ui.register": async (
      _input: { platform: "tui" | "desktop"; version: string },
      output: {
        panels?: PanelDefinition[]
      },
    ) => {
      output.panels = [
        {
          id: "demo-tabs",
          label: "Demo Tabs",
          area: "left",
          position: "bottom", // Will render after main tabs
        },
      ]
    },

    "ui.render": async (
      input: {
        componentId: string
        context: Record<string, any>
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

      if (componentId === "demo-tabs") {
        const tabs = ["demo1", "demo2", "demo3"]
        const tabLabels: Record<string, string> = {
          demo1: "Demo 1",
          demo2: "Demo 2",
          demo3: "Demo 3",
        }

        // Tab navigation
        let content = "=== Demo Tabs ===\n"
        content +=
          tabs
            .map((tab) => {
              const label = tabLabels[tab]
              const icon = tab === activeTab ? "●" : "○"
              return `${icon} ${label}`
            })
            .join("  ") + "\n\n"

        // Tab content
        if (activeTab === "demo1") {
          content += "Demo Panel 1\n\n"
          content += "This is the first demo panel.\n"
          content += `Counter: ${counter}\n`
          content += `Session: ${context.sessionID?.slice(0, 8) || "none"}\n`
          content += "\nClick to increment counter (demo)"
        } else if (activeTab === "demo2") {
          content += "Demo Panel 2\n\n"
          content += "This panel shows session info:\n"
          content += `- Session ID: ${context.sessionID || "unknown"}\n`
          content += `- Theme: ${context.theme || "dark"}\n`
          content += `- Counter: ${counter}\n`
        } else if (activeTab === "demo3") {
          content += "Demo Panel 3\n\n"
          content += "This panel shows plugin capabilities:\n"
          content += "✓ Multiple tabs\n"
          content += "✓ Tab switching\n"
          content += "✓ State management\n"
          content += "✓ Dynamic content\n"
          content += `✓ Counter state: ${counter}\n`
        }

        output.content = content
        output.type = "text"
      }
    },

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
      const { componentId, action, payload } = input

      if (componentId === "demo-tabs") {
        if (action === "switchTab") {
          activeTab = payload.tab
          output.result = { activeTab }
        } else if (action === "increment") {
          counter++
          output.result = { counter }
        }
      }
    },
  }
}

export default DemoTabsPlugin
