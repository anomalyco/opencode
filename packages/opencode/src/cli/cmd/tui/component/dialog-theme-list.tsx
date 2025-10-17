import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { THEMES, selectedTheme, setSelectedTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup } from "solid-js"

export function DialogThemeList() {
  const options = Object.keys(THEMES).map((theme) => ({
    title: theme,
    value: theme as keyof typeof THEMES,
  }))
  const initialTheme = selectedTheme()
  const dialog = useDialog()
  let confimed = false
  onCleanup(() => {
    if (!confimed) setSelectedTheme(initialTheme)
  })
  let ref: DialogSelectRef<keyof typeof THEMES>

  return (
    <DialogSelect
      title="Themes"
      options={options}
      onMove={(opt) => {
        setSelectedTheme(opt.value)
      }}
      onSelect={(opt) => {
        setSelectedTheme(opt.value)
        confimed = true
        dialog.clear()
      }}
      ref={(r) => (ref = r)}
      onFilter={(query) => {
        if (query.length === 0) setSelectedTheme(initialTheme)
        else if (ref.filtered[0].value) setSelectedTheme(ref.filtered[0].value)
      }}
    />
  )
}
