/**
 * Sidebar UI Plugin for OpenCode
 *
 * Provides the core sidebar UI components:
 * - Server status widget (top)
 * - Context bar widget (top)
 * - Main tabbed interface panel (inline/bottom)
 */

import type { Plugin } from "@opencode-ai/plugin"
import type { WidgetDefinition, PanelDefinition } from "../../src/ui/types"

export const SidebarUIPlugin = async (_ctx: any) => {
  let activeTab: "tools" | "todos" | "files" = "tools"

  return {
    "ui.register": async (
      _input: { platform: "tui" | "desktop"; version: string },
      output: {
        widgets?: WidgetDefinition[]
        panels?: PanelDefinition[]
      },
    ) => {
      output.widgets = [
        {
          id: "server-status",
          label: "Server Status",
          sidebarPosition: "top",
        },
        {
          id: "context-bar",
          label: "Context",
          sidebarPosition: "top",
        },
      ]

      output.panels = [
        {
          id: "main-tabs",
          label: "Main Tabs",
          area: "left",
          position: "bottom",
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

      if (componentId === "server-status") {
        const port = context.serverUrl?.split(":").pop() || "unknown"
        const status = context.serverStatus || "connected"
        const statusIcon = status === "connected" ? "●" : "○"

        output.content = `${statusIcon} server:${port}`
        output.type = "text"
      } else if (componentId === "context-bar") {
        const tokens = context.tokens || 0
        const tokenLimit = context.tokenLimit || 0
        const percentage = context.percentage || 0
        const cost = context.cost || "$0.00"

        output.content = [
          "Context",
          `${tokens.toLocaleString()} tokens`,
          `${percentage}% used`,
          `${cost} spent`,
        ].join("\n")
        output.type = "text"
      } else if (componentId === "main-tabs") {
        const tabs = ["tools", "todos", "files"]
        const toolsCount = (context.toolsUsed || []).length
        const todosCount = (context.todos || []).length
        const filesCount = (context.files || []).length

        const tabLabels: Record<string, string> = {
          tools: `Tools(${toolsCount})`,
          todos: `Todos(${todosCount})`,
          files: `Files(${filesCount})`,
        }

        // Tab navigation
        let content =
          tabs
            .map((tab) => {
              const label = tabLabels[tab]
              const icon = tab === activeTab ? "●" : "○"
              return `${icon} ${label}`
            })
            .join("  ") + "\n\n"

        // Tab content
        if (activeTab === "tools") {
          if (toolsCount > 0) {
            content += "Tools Used\n"
            content += (context.toolsUsed || [])
              .map((t: [string, number]) => `  ☆ ${t[0]} ×${t[1]}`)
              .join("\n")
          } else {
            content += "No tools used yet"
          }
        } else if (activeTab === "todos") {
          if (todosCount > 0) {
            content += "Todo\n"
            content += (context.todos || [])
              .map(
                (t: { status: string; content: string }) =>
                  `  [${t.status === "completed" ? "✓" : " "}] ${t.content}`,
              )
              .join("\n")
          } else {
            content += "No todos"
          }
        } else if (activeTab === "files") {
          if (filesCount > 0) {
            content += "Session Files\n"
            content += (context.files || [])
              .map(
                (f: { file: string; additions: number; deletions: number }) =>
                  `  ${f.file} +${f.additions} -${f.deletions}`,
              )
              .join("\n")
          } else {
            content += "No files changed"
          }
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

      if (componentId === "main-tabs" && action === "switchTab") {
        activeTab = payload.tab
        output.result = { activeTab }
      }
    },
  }
}

export default SidebarUIPlugin
