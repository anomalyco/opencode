import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "../context/theme"
import { wordmark } from "../logo"

export function Logo() {
  const { theme } = useTheme()

  return (
    <box>
      <For each={wordmark}>
        {(line) => (
          <box flexDirection="row">
            <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
              {line}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
