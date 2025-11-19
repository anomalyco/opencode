import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"

export function DialogAgent() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()

  const options = createMemo(() => {
    const allAgents = sync.data.agent
    const primaryAgents = allAgents.filter((x) => x.mode !== "subagent")
    const subagents = allAgents.filter((x) => x.mode === "subagent")

    const primaryOptions = primaryAgents.map((item) => ({
      value: item.name,
      title: item.name,
      description: item.builtIn ? "native" : item.description,
      category: "Primary Agents",
    }))

    const subagentOptions = subagents.map((item) => ({
      value: item.name,
      title: item.name,
      description: item.builtIn ? "native" : item.description,
      category: "Subagents (non-selectable)",
      disabled: true,
      bg: theme.backgroundPanel,
    }))

    return [...primaryOptions, ...subagentOptions]
  })

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        if (!option.disabled) {
          local.agent.set(option.value)
          dialog.clear()
        }
      }}
    />
  )
}
