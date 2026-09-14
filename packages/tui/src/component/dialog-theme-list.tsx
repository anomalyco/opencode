import { useLanguage } from "../context/language"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useThemes } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup } from "solid-js"

export function DialogThemeList() {
  const language = useLanguage()
  const themes = useThemes()
  const options = Object.keys(themes.all())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((value) => ({
      title: value,
      value: value,
    }))
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = themes.selected

  onCleanup(() => {
    if (!confirmed) themes.set(initial)
  })

  return (
    <DialogSelect
      title={language.t("tui.themes")}
      options={options}
      current={initial}
      onMove={(opt) => {
        themes.set(opt.value)
      }}
      onSelect={(opt) => {
        themes.set(opt.value)
        confirmed = true
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          themes.set(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) themes.set(first.value)
      }}
    />
  )
}
