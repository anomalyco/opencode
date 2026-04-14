import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useI18n } from "@tui/context/i18n"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogVariant() {
  const local = useLocal()
  const dialog = useDialog()
  const i18n = useI18n()

  const options = createMemo(() => {
    return [
      {
        value: "default",
        title: i18n.t("tui.dialog.variant.default"),
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(undefined)
        },
      },
      ...local.model.variant.list().map((variant) => ({
        value: variant,
        title: variant,
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(variant)
        },
      })),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={i18n.t("tui.dialog.variant.title")}
      current={local.model.variant.selected()}
      flat={true}
    />
  )
}
