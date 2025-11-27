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
  const [waveOffset, setWaveOffset] = createSignal(0)
  const [animationComplete, setAnimationComplete] = createSignal(false)

  onMount(() => {
    // Letter-by-letter reveal with individual delays
    const allChars = LOGO_LEFT.flatMap((line, lineIdx) =>
      line.split("").map((char, charIdx) => ({ char, lineIdx, charIdx, type: "left" })),
    ).concat(
      LOGO_RIGHT.flatMap((line, lineIdx) =>
        line.split("").map((char, charIdx) => ({ char, lineIdx, charIdx, type: "right" })),
      ),
    )

    let revealed = 0
    const revealInterval = setInterval(() => {
      revealed++
      if (revealed >= allChars.length) {
        clearInterval(revealInterval)
        setAnimationComplete(true)

        // Then: start wave animation
        let offset = 0
        setInterval(() => {
          offset += 0.05
          if (offset >= Math.PI * 2) offset = 0
          setWaveOffset(offset)
        }, 50)
      }
      setCharCount(revealed)
    }, 15)
  })

  // Calculate color for a character based on its position in the wave
  const getCharColor = (charIndex: number) => {
    if (!animationComplete()) return "#f05a28"

    // Create wave effect: each character has a phase offset based on position
    const phase = waveOffset() + (charIndex * 0.15)
    const sineValue = Math.sin(phase)
    const normalizedValue = (sineValue + 1) / 2
    const colorIdx = Math.floor(normalizedValue * (COLORS.length - 1))

    return COLORS[colorIdx]
  }

  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text>
              {line.substring(0, charCount()).split("").map((char, i) => (
                <text fg={getCharColor(i)}>{char}</text>
              ))}
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
