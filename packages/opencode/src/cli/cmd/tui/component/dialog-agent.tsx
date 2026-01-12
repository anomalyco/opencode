import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogAgentGenerate } from "./dialog-agent-generate"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => [
    {
      value: "create",
      title: "Create new agent...",
      description: "Define a new sub-agent behavior (AI or Manual)",
    },
    ...local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : item.description,
      }
    }),
  ])

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        if (option.value === "create") {
          dialog.replace(() => <DialogAgentGenerate />)
        } else {
          local.agent.set(option.value)
          dialog.clear()
        }
      }}
    />
  )
}
