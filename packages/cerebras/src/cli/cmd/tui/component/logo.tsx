import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For, createSignal, onMount, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [`                                         `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀█ █▀▀█ █▀▀▀`, `█░░░ █▀▀▀ █▀▀▄ █▀▀▀ █▀▀▄ █▀▀▄ █▀▀█ ▀▀▀█`, `▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀ ▀▀▀▀`]

const LOGO_RIGHT = [`                   `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

export function Logo() {
  const { theme } = useTheme()
  const [visible, setVisible] = createSignal(false)

  onMount(() => {
    setTimeout(() => setVisible(true), 100)
  })

  return (
    <box>
      <Show when={visible()}>
        <For each={LOGO_LEFT}>
          {(line, index) => (
            <box flexDirection="row" gap={1}>
              <text fg="#f05a28">{line}</text>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {LOGO_RIGHT[index()]}
              </text>
            </box>
          )}
        </For>
      </Show>
      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}
