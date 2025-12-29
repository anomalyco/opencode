import type { PluginInput, Hooks, SidebarPanel } from "@opencode-ai/plugin"

let counter = 0

export default async function sidebarDemoPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    sidebar: () => {
      counter++

      const panels: SidebarPanel[] = [
        {
          id: "demo-static",
          title: "Hello World",
          items: [
            { label: "Plugin Status", value: "Active", status: "success" },
            { label: "API Version", value: "1.0.0", status: "info" },
            { label: "Warnings", value: "2", status: "warning" },
            { label: "Errors", value: "0", status: "error" },
            { label: "Label Only (no value)" },
          ],
        },
        {
          id: "demo-dynamic",
          title: "Live Counter",
          items: [
            { label: "Render Count", value: String(counter), status: "info" },
            { label: "Timestamp", value: new Date().toLocaleTimeString() },
            {
              label: "Random",
              value: String(Math.floor(Math.random() * 100)),
              status: counter % 2 === 0 ? "success" : "warning",
            },
          ],
        },
      ]

      return panels
    },
  }
}
