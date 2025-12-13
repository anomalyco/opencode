import { createMemo, onMount, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "../ui/toast"
import { getAgent } from "@/acp/agents"
import { Keybind } from "@/util/keybind"
import { spawn } from "bun"

export function DialogAgents() {
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()

  onMount(() => dialog.setSize("medium"))

  async function openInstallGuide(agentName: string) {
    const agent = getAgent(agentName)
    const guide = agent?.installGuide
    if (!guide) {
      toast.show({
        variant: "warning",
        message: "No install guide available for this agent.",
        duration: 4000,
      })
      return
    }

    const platform = process.platform
    const cmd =
      platform === "darwin"
        ? ["open", guide]
        : platform === "win32"
          ? ["cmd", "/c", "start", "", guide]
          : ["xdg-open", guide]

    try {
      const proc = spawn(cmd, { stderr: "ignore", stdout: "ignore" })
      const exit = await proc.exited
      if (exit !== 0) {
        throw new Error(`command exited with ${exit}`)
      }
      toast.show({
        variant: "info",
        message: "Opening install guide...",
        duration: 3000,
      })
    } catch (error) {
      toast.show({
        variant: "warning",
        message: `Failed to open install guide. URL: ${guide}`,
        duration: 6000,
      })
    }
  }

  const options = createMemo(() => {
    return local.agent.list().map((agent) => {
      const needsInstall = !local.agent.isInstalled(agent.name)

      return {
        value: agent.name,
        title: agent.name,
        footer: needsInstall ? "Needs install" : undefined,
        onSelect: async () => {
          // Don't allow selecting uninstalled agents
          if (needsInstall) return
          dialog.clear()
          await local.agent.set(agent.name)
        },
      }
    })
  })

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+return")[0],
          title: "Open install guide",
          onTrigger: async (option) => {
            await openInstallGuide(option.value)
          },
        },
      ]}
    />
  )
}
