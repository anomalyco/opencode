import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

function truncate(str: string | undefined, maxLength: number): string {
  if (!str) return ""
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + "..."
}

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      // Use title if available, otherwise truncate description for display
      const displayTitle = item.title || truncate(item.description, 60) || item.name
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : displayTitle,
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
