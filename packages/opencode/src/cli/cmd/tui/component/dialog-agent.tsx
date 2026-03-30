import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogAgentCreate } from "./dialog-agent-create"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => [
    {
      value: "__create__",
      title: "Create new agent",
      description: "Create a custom subagent",
      category: "Actions",
    },
    ...local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : item.description,
        category: "Agents",
      }
    }),
  ])

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        if (option.value === "__create__") {
          dialog.replace(() => <DialogAgentCreate />)
          return
        }
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
