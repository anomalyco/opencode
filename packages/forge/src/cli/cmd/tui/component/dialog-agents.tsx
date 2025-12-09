import { createMemo, onMount } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { sortBy } from "remeda"

export function DialogAgents() {
  const local = useLocal()
  const dialog = useDialog()

  onMount(() => dialog.setSize("large"))

  const options = createMemo(() => {
    return sortBy(
      local.agent.list().map((agent) => {
        const needsInstall = !local.agent.isInstalled(agent.name)

        return {
          value: agent.name,
          title: agent.name,
          description: agent.description,
          footer: needsInstall ? "⬇ needs install" : undefined,
          onSelect: async () => {
            dialog.clear()
            await local.agent.set(agent.name)
          },
        }
      }),
      // Sort installed agents first, then alphabetically
      (x) => x.footer !== undefined,
      (x) => x.title,
    )
  })

  return <DialogSelect title="Select agent" current={local.agent.current().name} options={options()} />
}
