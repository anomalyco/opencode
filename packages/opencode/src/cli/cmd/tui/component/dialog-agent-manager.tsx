import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { useToast } from "@tui/ui/toast"

export function DialogAgentManager() {
  const local = useLocal()
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()

  const [agents, setAgents] = createSignal(local.agent.list())

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo(() => {
    const current = local.agent.current().name
    return agents().map((agent) => {
      const isCurrent = agent.name === current
      const emoji = agent.builtIn ? "🏠" : "👤"

      return {
        value: agent.name,
        title: `${emoji} ${agent.name}${isCurrent ? " (current)" : ""}`,
        footer: agent.description || (agent.builtIn ? "Built-in agent" : "Custom agent"),
        category: agent.builtIn ? "Built-in" : "Custom",
        bg: isCurrent ? theme.backgroundElement : undefined,
      }
    })
  })

  return (
    <DialogSelect
      title={`Agent Manager (${agents().length} agents)`}
      current={local.agent.current().name}
      options={options()}
      limit={50}
      onSelect={(option) => {
        local.agent.set(option.value)
        toast.show({
          message: `Switched to ${option.value} agent`,
          variant: "success",
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: Keybind.parse("r")[0],
          title: "reload",
          onTrigger: async () => {
            setAgents(local.agent.list())
            toast.show({
              message: "Agents reloaded",
              variant: "success",
            })
          },
        },
        {
          keybind: Keybind.parse("i")[0],
          title: "info",
          onTrigger: async (option) => {
            const agent = agents().find((a) => a.name === option.value)
            if (agent) {
              toast.show({
                message: `${agent.name}: ${agent.description || "No description"}`,
                variant: "info",
              })
            }
          },
        },
      ]}
    />
  )
}
