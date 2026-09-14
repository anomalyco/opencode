import { useLanguage } from "../../context/language"
import { createMemo } from "solid-js"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { abbreviateHome } from "../../util/path-format"
import { SessionQuestion } from "./permission"
import { usePromptMove } from "../../component/prompt/move"

export function SessionLocationMissing(props: { directory: string; projectID: string; sessionID: string }) {
  const move = usePromptMove({ projectID: () => props.projectID, sessionID: () => props.sessionID })
  return <SessionLocationUnavailable directory={props.directory} onMove={move.open} />
}

export function SessionLocationUnavailable(props: { directory: string; onMove: () => void }) {
  const language = useLanguage()
  const paths = useTuiPaths()
  const theme = useTheme("elevated")
  const directory = createMemo(() => Locale.truncateMiddle(abbreviateHome(props.directory, paths.home), 72))

  return (
    <SessionQuestion
      id="session.location-missing"
      group={language.t("tui.details.sessionRecovery")}
      choicesLabel={language.t("tui.details.recoveryActions")}
      instance={props.directory}
      title={language.t("tui.details.sessionLocationUnavailable")}
      body={
        <box paddingLeft={1} gap={1}>
          <text fg={theme.text.subdued}>{directory()}</text>
          <text fg={theme.text.default}>{language.t("tui.details.chooseAnotherDirectoryToContinueThisSession")}</text>
        </box>
      }
      options={{ move: language.t("tui.details.chooseDirectory") }}
      onSelect={props.onMove}
    />
  )
}
