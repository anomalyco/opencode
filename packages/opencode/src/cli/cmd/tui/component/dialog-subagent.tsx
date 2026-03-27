import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"

export function DialogSubagent() {
  const sync = useSync()

  const options = createMemo(() =>
    sync.data.agent
      .filter((item) => item.mode === "subagent" && !item.hidden)
      .map((item) => ({
        value: item.name,
        title: item.name,
        description: item.description,
      })),
  )

  return <DialogSelect title="Subagents" options={options()} />
}
