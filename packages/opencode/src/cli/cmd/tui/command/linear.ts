import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

/** Register 4 slash commands: /auto-progress, /linear-push, /linear-pull, /linear-status */
export function register(api: TuiPluginApi) {
  api.command.register(() => [
    {
      title: "Auto-progress start/stop",
      value: "linear.auto-progress",
      category: "Linear",
      slash: { name: "auto-progress" },
      onSelect: () => {
        const cur = api.kv.get("auto-progress:state", "idle")
        if (cur === "idle") {
          api.kv.set("auto-progress:state", "running")
          api.ui.toast({ title: "Auto-Progress", message: "Engine started", variant: "success" })
        } else {
          api.kv.set("auto-progress:state", "idle")
          api.ui.toast({ title: "Auto-Progress", message: "Engine stopped", variant: "info" })
        }
        api.ui.dialog.clear()
      },
    },
    {
      title: "Linear push",
      value: "linear.push",
      category: "Linear",
      slash: { name: "linear-push" },
      onSelect: () => {
        api.ui.toast({
          title: "Linear",
          message: "Not implemented — pending Linear MCP integration",
          variant: "info",
        })
        api.ui.dialog.clear()
      },
    },
    {
      title: "Linear pull",
      value: "linear.pull",
      category: "Linear",
      slash: { name: "linear-pull" },
      onSelect: () => {
        api.ui.toast({
          title: "Linear",
          message: "Not implemented — pending Linear MCP integration",
          variant: "info",
        })
        api.ui.dialog.clear()
      },
    },
    {
      title: "Linear status",
      value: "linear.status",
      category: "Linear",
      slash: { name: "linear-status" },
      onSelect: () => {
        const cfg = (api.state.config as Record<string, unknown>).linear as
          | Record<string, unknown>
          | undefined
        const projectId = cfg?.projectId ?? "Not configured"
        const teamId = cfg?.teamId ?? "Not configured"
        const syncMode = cfg?.syncMode ?? "manual"
        const connected = cfg ? "Connected" : "Disconnected"
        const lastSync = api.kv.get("linear:lastSync", "Never")

        api.ui.toast({
          title: "Linear Status",
          message: `${connected} | Project: ${projectId} | Team: ${teamId} | Mode: ${syncMode} | Last sync: ${lastSync}`,
          variant: "info",
        })
        api.ui.dialog.clear()
      },
    },
  ])
}
