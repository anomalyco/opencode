import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [
  ``,
  `█▀▀▀ █▀▀ █▀▀█ █▀▀ █▀▀▄ █▀▀█ █▀▀█ █▀▀▀`,
  `█    █▀▀ █▄▄▀ █▀▀ █▀▀▄ █▄▄▀ █▄▄█ ▀▀█ `,
  `▀▀▀▀ ▀▀▀ ▀  ▀ ▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀ ▀▀▀▀`,
]

const LOGO_RIGHT = [``, ``, ``, ``]

export function Logo() {
  const { theme } = useTheme()
  const [charCount, setCharCount] = createSignal(0)

  onMount(() => {
    const maxLength = Math.max(...LOGO_LEFT.map((l) => l.length)) + Math.max(...LOGO_RIGHT.map((l) => l.length))
    let current = 0
    const interval = setInterval(() => {
      current += 2
      if (current >= maxLength) {
        current = maxLength
        clearInterval(interval)
      }
      setCharCount(current)
    }, 25)
  })

  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg="#f05a28">{line.substring(0, charCount())}</text>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {LOGO_RIGHT[index()].substring(0, charCount())}
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
