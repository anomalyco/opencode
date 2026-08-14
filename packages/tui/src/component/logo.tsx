import { createSignal, For, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { logo } from "../logo"

const LINES = logo.right
const CELLS = LINES.map((line) => Array.from(line))
const WIDTH = LINES[0]?.length ?? 0
const PERIOD = 3600
const STAGGER = 80

export function Logo() {
  const { theme } = useTheme()
  const [now, setNow] = createSignal(0)

  onMount(() => {
    const origin = Date.now()
    const timer = setInterval(() => setNow(Date.now() - origin), 33)
    onCleanup(() => clearInterval(timer))
  })

  const shown = (row: number) => {
    const t = ((now() - row * STAGGER) % PERIOD) / PERIOD
    if (t < 0) return 0
    if (t < 0.25) return Math.floor((t / 0.25) * WIDTH)
    if (t < 0.75) return WIDTH
    return Math.max(0, Math.floor((1 - (t - 0.75) / 0.25) * WIDTH))
  }

  return (
    <box>
      <For each={CELLS}>
        {(line, row) => (
          <box flexDirection="row">
            <For each={line}>
              {(char, col) => (
                <text fg={theme.text} selectable={false}>
                  {col() < shown(row()) ? char : " "}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
