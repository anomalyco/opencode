import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useLanguage } from "../context/language"

export function DialogVariant() {
  const language = useLanguage()
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => [
    {
      value: "default",
      title: language.t("tui.dialogs.default"),
      onSelect: () => {
        dialog.clear()
        local.model.variant.set(undefined)
      },
    },
    ...local.model.variant
      .list()
      .filter((variant) => variant !== "default")
      .map((variant) => ({
        value: variant,
        title: variant,
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(variant)
        },
      })),
  ])

  return (
    <DialogSelect<string>
      options={options()}
      title={language.t("tui.dialogs.selectVariant")}
      current={local.model.variant.current() ?? "default"}
      flat={true}
    />
  )
}
