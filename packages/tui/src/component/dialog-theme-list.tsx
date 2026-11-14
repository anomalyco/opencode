import { DialogSelect } from "../ui/dialog-select"
import { useThemes } from "../context/theme"
import { useDialog } from "../ui/dialog"

/** `onClose` returns to the caller, e.g. Settings, instead of closing every dialog. */
export function DialogThemeList(props: { onClose?: () => void }) {
  const themes = useThemes()
  const options = Object.keys(themes.all())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((value) => ({
      title: value,
      value: value,
    }))
  const dialog = useDialog()
  const initial = themes.selected

  return (
    <DialogSelect
      title="Themes"
      searchInTitle
      titlePlaceholder="Search themes"
      options={options}
      current={initial}
      onCancel={props.onClose}
      onSelect={(opt) => {
        themes.set(opt.value)
        if (props.onClose) return props.onClose()
        dialog.clear()
      }}
    />
  )
}
