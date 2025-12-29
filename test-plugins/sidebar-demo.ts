import type { PluginInput, Hooks, SidebarPanel } from "@opencode-ai/plugin"

let counter = 0
let pluginLoaded = false

export default async function sidebarDemoPlugin(input: PluginInput): Promise<Hooks> {
  console.log("[sidebar-demo] Plugin loaded!")
  pluginLoaded = true

  return {
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type === "session.created") {
        console.log("[sidebar-demo] Session created - showing toast")
        const props = event.properties as { info?: { parentID?: string } } | undefined
        if (props?.info?.parentID) return

        setTimeout(async () => {
          try {
            await input.$`osascript -e ${'display notification "Sidebar Demo Plugin Loaded!" with title "Hello World"'}`
            console.log("[sidebar-demo] Toast shown successfully")
          } catch (e) {
            console.log("[sidebar-demo] Toast failed:", e)
          }
        }, 500)
      }
    },

    sidebar: () => {
      counter++
      console.log("[sidebar-demo] sidebar() called, counter:", counter)

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
