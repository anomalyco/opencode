import { useLanguage } from "../context/language"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useThemes } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup } from "solid-js"

/** `onClose` returns to the caller, e.g. Settings, instead of closing every dialog. */
export function DialogThemeList(props: { onClose?: () => void }) {
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
      searchInTitle
      titlePlaceholder={language.t("tui.interface.searchThemes")}
      options={options}
      current={initial}
      onCancel={props.onClose}
      onMove={(opt) => {
        themes.set(opt.value)
      }}
      onSelect={(opt) => {
        themes.set(opt.value)
        confirmed = true
        if (props.onClose) return props.onClose()
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
