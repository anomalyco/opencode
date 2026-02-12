import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { createSignal, For, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"

const MODES = ["auto", "dark", "light"] as const

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
  const initialMode = theme.mode()
  const [mode, setMode] = createSignal(initialMode)

  onCleanup(() => {
    if (!confirmed) {
      theme.set(initial)
      theme.setMode(initialMode)
    }
  })

  function cycleMode(direction: 1 | -1) {
    const idx = MODES.indexOf(mode())
    const next = MODES[(idx + direction + MODES.length) % MODES.length]!
    setMode(next)
    theme.setMode(next)
  }

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
      onKeyboard={(evt) => {
        if (evt.name === "left" || evt.name === "right") {
          cycleMode(evt.name === "right" ? 1 : -1)
          return true
        }
      }}
      header={
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.theme.text} attributes={TextAttributes.BOLD}>
              Appearance
            </text>
            <text fg={theme.theme.textMuted}>{"←/→"}</text>
          </box>
          <box flexDirection="row" gap={2} paddingTop={1}>
            <For each={MODES}>
              {(m) => (
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseUp={() => {
                    setMode(m)
                    theme.setMode(m)
                  }}
                >
                  <text fg={mode() === m ? theme.theme.primary : theme.theme.textMuted}>
                    {mode() === m ? "●" : "○"}
                  </text>
                  <text fg={mode() === m ? theme.theme.text : theme.theme.textMuted}>{m}</text>
                </box>
              )}
            </For>
          </box>
        </box>
      }
    />
  )
}
