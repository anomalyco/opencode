import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For, createSignal } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [`                   `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀▀`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

const LOGO_RIGHT = [`                   `, `█▀▀▀ █  █ █▀▀█ █▀▀▀`, `▀▀▀█ █  █ █▄▄▀ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀   `]

// Alternative logo with bracket design
const LOGO_ALT_BRACKET = [
  ` ██╗      `,
  `  ██╗     `,
  `  ╚██╗    `,
  `  ██╔╝    `,
  ` ██╔╝     `,
  ` ╚═╝      `,
]

const LOGO_ALT_TEXT = [
  ` █████╗  █████╗ ██████╗ ███████╗ ██████╗██╗   ██╗██████╗ ███████╗`,
  `██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔════╝██║   ██║██╔══██╗██╔════╝`,
  `██║  ╚═╝██║  ██║██║  ██║█████╗  ╚█████╗░██║   ██║██████╔╝█████╗`,
  `██║  ██╗██║  ██║██║  ██║██╔══╝   ╚═══██╗██║   ██║██╔══██╗██╔══╝`,
  `╚█████╔╝╚█████╔╝██████╔╝███████╗██████╔╝╚██████╔╝██║  ██║██║`,
  ` ╚════╝  ╚════╝ ╚═════╝ ╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝    `,
]

export type LogoVariant = "default" | "bracket"

interface LogoProps {
  variant?: LogoVariant
}

export function Logo(props: LogoProps) {
  const { theme } = useTheme()
  const variant = () => props.variant ?? "default"

  return (
    <box>
      {variant() === "bracket" ? (
        <For each={LOGO_ALT_BRACKET}>
          {(line, index) => (
            <box flexDirection="row">
              <text fg={theme.accent}>{line}</text>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {LOGO_ALT_TEXT[index()]}
              </text>
            </box>
          )}
        </For>
      ) : (
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
      )}
      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}
