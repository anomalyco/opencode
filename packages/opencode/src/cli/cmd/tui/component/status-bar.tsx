import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { TextAttributes } from "@opentui/core"
import { useGitBranch } from "./status-bar/git"

export function StatusBar() {
  const { theme } = useTheme()
  const local = useLocal()
  const { branch } = useGitBranch()

  return (
    <box
      height={1}
      backgroundColor={theme.backgroundPanel}
      flexDirection="row"
      justifyContent="space-between"
      flexShrink={0}
    >
      <box flexDirection="row">
        <box flexDirection="row" backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>open</text>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            code{" "}
          </text>
          <text fg={theme.textMuted}>v{Installation.VERSION}</text>
        </box>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>
            {process.cwd().replace(Global.Path.home, "~")}
            {branch() ? `:${branch()}` : ""}
          </text>
        </box>
      </box>
      <box flexDirection="row" flexShrink={0}>
        <text fg={theme.textMuted} paddingRight={1}>
          tab
        </text>
        <text fg={local.agent.color(local.agent.current().name)}>{""}</text>
        <text bg={local.agent.color(local.agent.current().name)} fg={theme.background} wrapMode={undefined}>
          <span style={{ bold: true }}> {local.agent.current().name.toUpperCase()}</span>
          <span> AGENT </span>
        </text>
      </box>
    </box>
  )
}
