import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "../context/theme"
import { wordmark, wordmarkGradient } from "../logo"

export function Logo() {
  const { mode } = useTheme()

  // Resolve the gradient color for a wordmark line, reactive on the theme mode.
  const color = (index: number) => {
    const gradient = wordmarkGradient[mode()]
    return gradient[index] ?? gradient[gradient.length - 1]
  }

  return (
    <box>
      <For each={wordmark}>
        {(line, index) => (
          <box flexDirection="row">
            <text fg={color(index())} attributes={TextAttributes.BOLD} selectable={false}>
              {line}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
