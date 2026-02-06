import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

function truncate(text: string | undefined, maxLength: number): string | undefined {
  if (!text || text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + "…"
}

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : truncate(item.description, 60),
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
