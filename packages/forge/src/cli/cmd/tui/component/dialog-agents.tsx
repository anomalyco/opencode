import { createMemo, onMount } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogAgentInstall } from "./dialog-agent-install"

export function DialogAgents() {
  const local = useLocal()
  const dialog = useDialog()

  onMount(() => dialog.setSize("large"))

  const options = createMemo(() => {
    return local.agent.list().map((agent) => {
      const needsInstall = !local.agent.isInstalled(agent.name)

      return {
        value: agent.name,
        title: agent.name,
        description: agent.description,
        needsInstall,
        onSelect: async () => {
          if (needsInstall) {
            dialog.replace(() => <DialogAgentInstall agentName={agent.name} />)
            return
          }
          dialog.clear()
          await local.agent.set(agent.name, dialog)
        },
      }
    })
  })

  return <DialogSelect title="Select agent" current={local.agent.current()?.name ?? undefined} options={options()} />
}
