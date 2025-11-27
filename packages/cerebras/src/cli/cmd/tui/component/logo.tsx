import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO = [
  `        ╭───────╮              `,
  `      ╭─┤       ├─╮            `,
  `    ╭─┤ │  ╭─╮  │ ├─╮          `,
  `   ╭┤ │ │ ╭┤ ╰╮ │ │ ├╮         `,
  `   ││ │ │ ││   │ │ │ ││         `,
  `   ╰┤ │ │ ╰┤ ╭╯ │ │ ├╯         `,
  `    ╰─┤ │  ╰─╯  │ ├─╯          `,
  `      ╰─┤       ├─╯            `,
  `        ╰───────╯              `,
]

const TEXT = `     CEREBRAS CODE`

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO}>
        {(line) => (
          <box flexDirection="row">
            <text fg="orange">{line}</text>
          </box>
        )}
      </For>
      <box flexDirection="row" paddingTop={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>{TEXT}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}
