import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useLanguage } from "../context/language"

export function DialogAgent() {
  const language = useLanguage()
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.id,
        title: item.id,
        description: item.description,
      }
    }),
  )

  return (
    <DialogSelect
      title={language.t("tui.dialogs.selectAgent")}
      current={local.agent.current()?.id}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
