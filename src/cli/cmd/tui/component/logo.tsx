import { For, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Installation } from "@/installation"

/**
 * Athena Browser Agent logo — clean text with purple accent diamond.
 * No bulky ASCII art, just styled text.
 */
export function Logo() {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      <box flexDirection="row" gap={0}>
        <text fg={theme.primary} selectable={false}>
          {"  ◆  "}
        </text>
      </box>
      <box flexDirection="row" gap={0}>
        <text fg={theme.primary} selectable={false}>
          {" ◆ ◆ "}
        </text>
      </box>
      <box flexDirection="row" gap={0}>
        <text fg={theme.primary} selectable={false}>
          {"◆   ◆"}
        </text>
      </box>
      <box height={1} />
      <box flexDirection="row" gap={0}>
        <text fg={theme.text} selectable={false}>
          <span style={{ bold: true, fg: theme.text }}>athena</span>
          <span style={{ fg: theme.textMuted }}> browser</span>
        </text>
      </box>
    </box>
  )
}
