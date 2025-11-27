import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [`                                         `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀█ █▀▀█ █▀▀▀`, `█░░░ █▀▀▀ █▀▀▄ █▀▀▀ █▀▀▄ █▀▀▄ █▀▀█ ▀▀▀█`, `▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀ ▀▀▀▀`]

const LOGO_RIGHT = [`                   `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

export function Logo() {
  const { theme } = useTheme()
  const [opacity, setOpacity] = createSignal(0)

  onMount(() => {
    let current = 0
    const interval = setInterval(() => {
      current += 0.05
      if (current >= 1) {
        current = 1
        clearInterval(interval)
      }
      setOpacity(current)
    }, 30)
  })

  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg="#f05a28" style={{ opacity: opacity() }}>{line}</text>
            <text fg={theme.text} attributes={TextAttributes.BOLD} style={{ opacity: opacity() }}>
              {LOGO_RIGHT[index()]}
            </text>
          </box>
        )}
      </For>
      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}
