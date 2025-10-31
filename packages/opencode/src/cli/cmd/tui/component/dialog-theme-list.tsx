import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { THEMES, useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { onCleanup, onMount } from "solid-js"

export function DialogThemeList() {
  const { selectedTheme, setSelectedTheme } = useTheme()
  const options = Object.keys(THEMES).map((value) => ({
    title: value,
    value: value as keyof typeof THEMES,
  }))
  const initial = selectedTheme()
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<keyof typeof THEMES>

  onMount(() => {
    // highlight the first theme in the list when we open it for UX
    setSelectedTheme(Object.keys(THEMES)[0] as keyof typeof THEMES)
  })
  onCleanup(() => {
    // if we close the dialog without confirming, reset back to the initial theme
    if (!confirmed) setSelectedTheme(initial)
  })

  return (
    <DialogSelect
      title="Themes"
      options={options}
      onMove={(opt) => {
        setSelectedTheme(opt.value)
      }}
      onSelect={(opt) => {
        setSelectedTheme(opt.value)
        confirmed = true
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          setSelectedTheme(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) setSelectedTheme(first.value)
      }}
    />
  )
}
