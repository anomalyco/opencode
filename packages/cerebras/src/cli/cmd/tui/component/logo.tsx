import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [
  `                                         `,
  `█▀▀▀ █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀█ █▀▀█ █▀▀▀`,
  `█░░░ █▀▀▀ █▀▀▄ █▀▀▀ █▀▀▄ █▀▀▄ █▀▀█ ▀▀▀█`,
  `▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀ ▀▀▀▀`,
]

const LOGO_RIGHT = [`                   `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

// Color variations for pulse effect - many steps for ultra-smooth transition
const COLORS = [
  "#ff7a50",
  "#ff7248",
  "#ff6a40",
  "#ff6238",
  "#f85a30",
  "#f05a28",
  "#ed5624",
  "#ea5220",
  "#e74e1c",
  "#e54a18",
  "#e24614",
  "#e04210",
  "#dd3e0c",
  "#db3a08",
  "#d83604",
  "#d63200",
  "#d32e00",
  "#d12a00",
  "#ce2600",
  "#cc2200",
  "#c91e00",
  "#c71a00",
  "#c41600",
  "#c21200",
  "#bf0e00",
  "#bd0a00",
  "#ba0600",
  "#b80200",
  "#b50000",
  "#b30000",
  "#b00000",
  "#ad0200",
  "#ab0400",
  "#a80600",
  "#a60800",
  "#a30a00",
  "#a10c00",
  "#9e0e00",
  "#9c1000",
  "#991200",
  "#971400",
  "#941600",
  "#921800",
  "#8f1a00",
  "#8d1c00",
  "#8a1e00",
  "#882000",
  "#852200",
  "#832400",
  "#802600",
  "#7e2800",
  "#7b2a00",
  "#792c00",
  "#762e00",
  "#743000",
  "#713200",
  "#6f3400",
  "#6c3600",
  "#6a3800",
  "#673a00",
]

export function Logo() {
  const { theme } = useTheme()
  const [charCount, setCharCount] = createSignal(0)
  const [colorIndex, setColorIndex] = createSignal(0)
  const [animationComplete, setAnimationComplete] = createSignal(false)

  onMount(() => {
    // First: typewriter animation
    const maxLength = Math.max(...LOGO_LEFT.map((l) => l.length)) + Math.max(...LOGO_RIGHT.map((l) => l.length))
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
        }, 400)
      }
      setCharCount(current)
    }, 25)
  })

  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg={animationComplete() ? COLORS[colorIndex()] : "#f05a28"}>{line.substring(0, charCount())}</text>
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
