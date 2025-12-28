import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [
  `                        `,
  `█▀▀▀ █▀▀█ █░░█ █▀▀█ █▀▀█`,
  `▀▀▀█ █▀▀▀ █░░█ █▀▀▄ █░░█`,
  `▀▀▀▀ ▀▀▀▀  ▀▀  ▀  ▀ ▀▀▀▀`,
]

const LOGO_RIGHT = [
  `             ▄     `,
  `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`,
  `█░░░ █░░█ █░░█ █▀▀▀`,
  `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`,
]

const DIVIDER = `════════════════════════════════════════════════`
const TAGLINE = `         ⚔️ 🐺  Omnis Vir Lupus  🐺 ⚔️`

export function Logo() {
  const { theme } = useTheme()

  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted} selectable={false}>
              {line}
            </text>
            <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
              {LOGO_RIGHT[index()]}
            </text>
          </box>
        )}
      </For>
      <text fg={theme.warning} selectable={false} marginTop={0.5}>
        {DIVIDER}
      </text>
      <text fg={theme.textMuted} selectable={false}>
        {TAGLINE}
      </text>
    </box>
  )
}
