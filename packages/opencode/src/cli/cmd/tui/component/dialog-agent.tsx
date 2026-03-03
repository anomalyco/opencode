import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      const displayDesc = item.shortDescription 
        || (item.description && item.description.length > 100 
          ? item.description.substring(0, 100) + "..." 
          : item.description)
        || ""
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : displayDesc,
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
