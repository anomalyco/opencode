import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { THEMES, useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup, onMount } from "solid-js"

export function DialogThemeList() {
  const theme = useTheme()
  const options = Object.keys(THEMES).map((value) => ({
    title: value,
    value: value as keyof typeof THEMES,
  }))
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<keyof typeof THEMES>
  const initial = theme.selected

  onMount(() => {
    // highlight the first theme in the list when we open it for UX
    theme.set(Object.keys(THEMES)[0] as keyof typeof THEMES)
  })

  onCleanup(() => {
    // if we close the dialog without confirming, reset back to the initial theme
    if (!confirmed) theme.set(initial)
  })

  return (
    <DialogSelect
      title="Themes"
      options={options}
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
