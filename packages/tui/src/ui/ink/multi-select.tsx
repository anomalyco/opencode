import { createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Glyphs } from "../glyphs"

export interface MultiSelectOption<T = unknown> {
  label: string
  value: T
  description?: string
}

export function InkMultiSelect<T>(props: {
  options: MultiSelectOption<T>[]
  selected?: T[]
  onChange?: (selected: T[]) => void
  onConfirm?: (selected: T[]) => void
  label?: string
  hint?: string
  width?: number
}) {
  const { theme } = useTheme()
  const [cursor, setCursor] = createSignal(0)
  const isSelected = (val: T) => (props.selected ?? []).some((s) => s === val)

  const toggle = (val: T) => {
    const current = props.selected ?? []
    const next = current.some((s) => s === val)
      ? current.filter((s) => s !== val)
      : [...current, val]
    props.onChange?.(next)
  }

  return (
    <box
      flexDirection="column"
      border={["top", "bottom", "left", "right"]}
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      width={props.width ?? 38}
    >
      {/* Label header */}
      <Show when={props.label}>
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.primary}>
          <text fg={theme.background}>
            <b>{` ${props.label} `}</b>
          </text>
        </box>
      </Show>

      {/* Options */}
      <For each={props.options}>
        {(opt, i) => {
          const isActive = () => i() === cursor()
          const checked = () => isSelected(opt.value)
          return (
            <box
              flexDirection="row"
              alignItems="center"
              paddingLeft={1}
              paddingRight={1}
              gap={1}
              backgroundColor={isActive() ? theme.backgroundElement : theme.backgroundPanel}
              onMouseDown={() => {
                setCursor(i())
                toggle(opt.value)
              }}
            >
              {/* Checkbox */}
              <text fg={checked() ? theme.success : theme.border}>
                <b>{checked() ? "◉" : "○"}</b>
              </text>

              {/* Label + description */}
              <box flexDirection="column" flexGrow={1}>
                <text fg={isActive() ? theme.accent : theme.text}>
                  {isActive() ? <b>{opt.label}</b> : opt.label}
                </text>
                <Show when={opt.description}>
                  <text fg={theme.textMuted}>{opt.description}</text>
                </Show>
              </box>
            </box>
          )
        }}
      </For>

      {/* Footer hint */}
      <box
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        borderColor={theme.borderSubtle}
        border={["top"]}
      >
        <text fg={theme.textMuted}>
          {props.hint ?? "Space to toggle · Enter to confirm"}
        </text>
      </box>
    </box>
  )
}
