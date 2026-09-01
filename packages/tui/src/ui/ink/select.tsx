import { createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Glyphs } from "../glyphs"

export interface SelectOption<T = unknown> {
  label: string
  value: T
  description?: string
  disabled?: boolean
}

export function InkSelect<T>(props: {
  options: SelectOption<T>[]
  value?: T
  onChange?: (value: T, option: SelectOption<T>) => void
  label?: string
  width?: number
}) {
  const { theme } = useTheme()
  const initialIdx = () => Math.max(0, props.options.findIndex((o) => o.value === props.value))
  const [cursor, setCursor] = createSignal(initialIdx())

  const select = (idx: number) => {
    const opt = props.options[idx]
    if (!opt || opt.disabled) return
    setCursor(idx)
    props.onChange?.(opt.value, opt)
  }

  return (
    <box
      flexDirection="column"
      border={["top", "bottom", "left", "right"]}
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      width={props.width ?? 38}
    >
      <Show when={props.label}>
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.primary}>
          <text fg={theme.background}>
            <b>{` ${props.label} `}</b>
          </text>
        </box>
      </Show>
      <For each={props.options}>
        {(opt, i) => {
          const isActive = () => i() === cursor()
          const isSelected = () => opt.value === props.value
          return (
            <box
              flexDirection="row"
              alignItems="center"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={isActive() ? theme.backgroundElement : theme.backgroundPanel}
              onMouseDown={() => select(i())}
            >
              <text fg={isActive() ? theme.accent : theme.textMuted}>
                {isActive() ? Glyphs.pointer : " "}
                {"  "}
              </text>
              <box flexDirection="column" flexGrow={1}>
                <text
                  fg={
                    opt.disabled ? theme.textMuted : isSelected() ? theme.accent : theme.text
                  }
                >
                  <b>{opt.label}</b>
                </text>
                <Show when={opt.description}>
                  <text fg={theme.textMuted}>{opt.description}</text>
                </Show>
              </box>
              <Show when={isSelected()}>
                <text fg={theme.success}>
                  <b>{Glyphs.tick}</b>
                </text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
