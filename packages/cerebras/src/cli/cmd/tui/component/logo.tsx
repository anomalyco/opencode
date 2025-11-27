import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [`                                         `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀█ █▀▀█ █▀▀▀`, `█░░░ █▀▀▀ █▀▀▄ █▀▀▀ █▀▀▄ █▀▀▄ █▀▀█ ▀▀▀█`, `▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀ ▀▀▀▀`]

const LOGO_RIGHT = [`                   `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

// Color variations for pulse effect - from bright to dim orange
const COLORS = ["#f05a28", "#e04818", "#d03808", "#c02808", "#b01808"]

export function Logo() {
  const { theme } = useTheme()
  const [charCount, setCharCount] = createSignal(0)
  const [colorIndex, setColorIndex] = createSignal(0)
  const [animationComplete, setAnimationComplete] = createSignal(false)

  onMount(() => {
    // First: typewriter animation
    const maxLength = Math.max(...LOGO_LEFT.map(l => l.length)) + Math.max(...LOGO_RIGHT.map(l => l.length))
    let current = 0
    const typeInterval = setInterval(() => {
      current += 2
      if (current >= maxLength) {
        current = maxLength
        clearInterval(typeInterval)
        setAnimationComplete(true)

        // Then: start pulse animation
        let pulseDirection = 1
        let colorIdx = 0
        setInterval(() => {
          colorIdx += pulseDirection
          if (colorIdx >= COLORS.length - 1) pulseDirection = -1
          if (colorIdx <= 0) pulseDirection = 1
          setColorIndex(colorIdx)
        }, 200)
      }
      setCharCount(current)
    }, 25)
  })

  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg={animationComplete() ? COLORS[colorIndex()] : "#f05a28"}>
              {line.substring(0, charCount())}
            </text>
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
