import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { applyArabicFont, fontChoices } from "../util/terminal-font"

// The TUI cannot render with its own font, so this dialog picks the font the
// terminal uses for Arabic text and writes it into the terminal's settings
// (Windows Terminal or VS Code). It never installs fonts.
export function DialogFonts() {
  const dialog = useDialog()
  const toast = useToast()
  const options = fontChoices().map((choice) => ({
    title: choice.family,
    value: choice.family,
    description: choice.installed
      ? choice.recommended
        ? "installed · recommended for Arabic"
        : "installed"
      : "not installed — the terminal will fall back to another font",
    category: choice.recommended ? "Recommended for Arabic" : "All installed fonts",
  }))

  return (
    <DialogSelect
      title="Terminal font for Arabic"
      placeholder="Search fonts…"
      options={options}
      onSelect={(option) => {
        const result = applyArabicFont(option.value)
        if (!result.ok) {
          toast.show({ variant: "error", message: result.message, duration: 6000 })
          return
        }
        dialog.clear()
        toast.show({
          variant: "success",
          message: `${option.value} set in ${result.target}. ${result.hint}`,
          duration: 10000,
        })
      }}
      footer={`Saved with a backup next to the settings file. The TUI itself cannot choose fonts — the terminal does.`}
    />
  )
}
