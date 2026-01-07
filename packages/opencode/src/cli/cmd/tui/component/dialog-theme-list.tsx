import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme, type ColorScheme, getThemeModeSupport, type ThemeModeSupport } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { createMemo, createSignal, For, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"

const APPEARANCE_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

function isOptionEnabled(option: ColorScheme, support: ThemeModeSupport): boolean {
  if (support.dark && support.light) return true
  if (option === "system") return support.dark && support.light
  if (option === "dark") return support.dark
  if (option === "light") return support.light
  return false
}

function AppearanceSelector(props: { modeSupport: ThemeModeSupport }) {
  const theme = useTheme()
  const enabledOptions = createMemo(() =>
    APPEARANCE_OPTIONS.filter((opt) => isOptionEnabled(opt.value, props.modeSupport)),
  )
  const selectedIndex = createMemo(() => enabledOptions().findIndex((opt) => opt.value === theme.colorScheme()))

  useKeyboard((evt) => {
    const options = enabledOptions()
    if (options.length <= 1) return

    if (evt.name === "left") {
      evt.preventDefault()
      const prev = (selectedIndex() - 1 + options.length) % options.length
      theme.setColorScheme(options[prev].value)
    }
    if (evt.name === "right") {
      evt.preventDefault()
      const next = (selectedIndex() + 1) % options.length
      theme.setColorScheme(options[next].value)
    }
  })

  return (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.theme.text} attributes={TextAttributes.BOLD}>
          Appearance
        </text>
        <text fg={theme.theme.textMuted}>←/→</text>
      </box>
      <box flexDirection="row" gap={2} paddingTop={1}>
        <For each={APPEARANCE_OPTIONS}>
          {(option) => {
            const isSelected = createMemo(() => theme.colorScheme() === option.value)
            const isEnabled = createMemo(() => isOptionEnabled(option.value, props.modeSupport))
            return (
              <box flexDirection="row" gap={1} onMouseUp={() => isEnabled() && theme.setColorScheme(option.value)}>
                <text
                  fg={!isEnabled() ? theme.theme.border : isSelected() ? theme.theme.primary : theme.theme.textMuted}
                >
                  {isSelected() ? "●" : "○"}
                </text>
                <text fg={!isEnabled() ? theme.theme.border : isSelected() ? theme.theme.text : theme.theme.textMuted}>
                  {option.label}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}

function getModeIndicator(support: ThemeModeSupport): string {
  if (support.dark && support.light) return ""
  if (support.dark) return "dark"
  if (support.light) return "light"
  return ""
}

export function DialogThemeList() {
  const theme = useTheme()
  const allThemes = theme.all()
  const options = Object.keys(allThemes)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((value) => {
      const support = getThemeModeSupport(allThemes[value])
      const indicator = getModeIndicator(support)
      return {
        title: value,
        value: value,
        footer: indicator,
      }
    })
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = theme.selected
  const initialColorScheme = theme.colorScheme()

  const currentModeSupport = createMemo(() => {
    const currentTheme = allThemes[theme.selected]
    return currentTheme ? getThemeModeSupport(currentTheme) : { dark: true, light: true }
  })

  function handleThemeChange(themeName: string) {
    theme.set(themeName)
    const support = getThemeModeSupport(allThemes[themeName])
    if (!support.light && support.dark) {
      theme.setColorScheme("dark")
    } else if (!support.dark && support.light) {
      theme.setColorScheme("light")
    }
  }

  onCleanup(() => {
    if (!confirmed) {
      theme.set(initial)
      theme.setColorScheme(initialColorScheme)
    }
  })

  return (
    <box flexDirection="column">
      <AppearanceSelector modeSupport={currentModeSupport()} />
      <DialogSelect
        title="Theme"
        options={options}
        current={initial}
        onMove={(opt) => {
          handleThemeChange(opt.value)
        }}
        onSelect={(opt) => {
          handleThemeChange(opt.value)
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
          if (first) handleThemeChange(first.value)
        }}
      />
    </box>
  )
}
