import { createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { Keymap } from "@/config/keymap"

export function DialogKeymap() {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  const current = (sync.data.config.keymap ?? "default") as Keymap.Name
  const [selected, setSelected] = createSignal<Keymap.Name>(current)

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
      return
    }
    if (evt.name === "j" || evt.name === "down") {
      const idx = Keymap.Names.indexOf(selected())
      const next = Keymap.Names[(idx + 1) % Keymap.Names.length]
      setSelected(next)
      return
    }
    if (evt.name === "k" || evt.name === "up") {
      const idx = Keymap.Names.indexOf(selected())
      const next = Keymap.Names[(idx - 1 + Keymap.Names.length) % Keymap.Names.length]
      setSelected(next)
      return
    }
    if (evt.name === "return") {
      const name = selected()
      dialog.clear()
      if (name === current) {
        toast.show({
          variant: "info",
          title: `Keymap: ${name}`,
          message: Keymap.hints(name).slice(0, 2).join(" | "),
          duration: 4000,
        })
        return
      }
      toast.show({
        variant: "info",
        title: `To use ${name} keymap`,
        message: `Add "keymap": "${name}" to your opencode.json`,
        duration: 6000,
      })
    }
  })

  const hints = () => Keymap.hints(selected())

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Keymaps
        </text>
        <text fg={theme.textMuted}>j/k to navigate · enter to select · esc to close</text>
      </box>

      <box flexDirection="row" gap={2} paddingTop={1}>
        {Keymap.Names.map((name) => (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={selected() === name ? theme.primary : undefined}
            onMouseUp={() => setSelected(name)}
          >
            <text
              fg={selected() === name ? theme.selectedListItemText : current === name ? theme.accent : theme.text}
              attributes={selected() === name ? TextAttributes.BOLD : TextAttributes.NONE}
            >
              {name}
              {current === name ? " ✓" : ""}
            </text>
          </box>
        ))}
      </box>

      <box paddingTop={1}>
        <text fg={theme.textMuted}>{Keymap.describe(selected())}</text>
      </box>

      <box paddingTop={1} gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Key bindings:
        </text>
        {hints().map((hint) => (
          <text fg={theme.textMuted}>• {hint}</text>
        ))}
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>select</text>
        </box>
      </box>
    </box>
  )
}
