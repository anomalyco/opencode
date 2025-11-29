import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [`                   `, `█▀▀█ █▀▀█ █▀▀█ █▀▀▄`, `█░░█ █░░█ █▀▀▀ █░░█`, `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀`]

const LOGO_RIGHT = [`             ▄     `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>{line}</text>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
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
