import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup, onMount } from "solid-js"

export function DialogThemeList() {
  const theme = useTheme()
  const options = Object.keys(theme.all())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((value) => ({
      title: value,
      value: value,
    }))
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = theme.selected

  onCleanup(() => {
    if (!confirmed) theme.set(initial)
  })

  return (
    <DialogSelect
      title="Themes"
      options={options}
      current={initial}
      onMove={(opt) => {
        theme.set(opt.value)
      }}
      onSelect={(opt) => {
        theme.set(opt.value)
        confirmed = true
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          theme.set(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) theme.set(first.value)
      }}
    />
  )
}
