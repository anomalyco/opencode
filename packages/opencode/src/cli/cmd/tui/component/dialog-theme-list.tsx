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
  const state = { confirmed: false, ref: undefined as DialogSelectRef<keyof typeof THEMES> | undefined }

  onMount(() => {
    // highlight the first theme in the list when we open it for UX
    setSelectedTheme(Object.keys(THEMES)[0] as keyof typeof THEMES)
  })
  onCleanup(() => {
    // if we close the dialog without confirming, reset back to the initial theme
    if (!state.confirmed) setSelectedTheme(initial)
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
        state.confirmed = true
        dialog.clear()
      }}
      ref={(ref) => {
        state.ref = ref
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          setSelectedTheme(initial)
          return
        }

        const first = state.ref?.filtered[0]
        if (first) setSelectedTheme(first.value)
      }}
    />
  )
}
