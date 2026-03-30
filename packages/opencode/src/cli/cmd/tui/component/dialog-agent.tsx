import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogAgentCreate, DialogAgentDelete, DialogAgentEdit } from "./dialog-agent-create"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => {
    const agentOptions = local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : "custom",
        onSelect: () => {
          local.agent.set(item.name)
          dialog.clear()
        },
      }
    })

    const managementOptions = [
      {
        value: "create",
        title: "Create agent",
        description: "Create a new agent",
        category: "Manage",
        onSelect: () => {
          dialog.replace(() => <DialogAgentCreate />)
        },
      },
      {
        value: "edit",
        title: "Edit agent",
        description: "Edit an existing agent",
        category: "Manage",
        onSelect: () => {
          dialog.replace(() => <DialogAgentEdit />)
        },
      },
      {
        value: "delete",
        title: "Delete agent",
        description: "Delete an existing agent",
        category: "Manage",
        onSelect: () => {
          dialog.replace(() => <DialogAgentDelete />)
        },
      },
    ]

    return [...agentOptions, ...managementOptions]
  })

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={() => {}}
    />
  )
}
