import { useTheme } from "../context/theme"
import { useLanguage } from "../context/language"

export function PluginRouteMissing(props: { id: string; name: string; onHome: () => void }) {
  const language = useLanguage()
  const theme = useTheme()

  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
      <text fg={theme.text.feedback.warning.default}>
        {language.t("tui.dialogs.unknownPluginRoute", { route: `${props.id}/${props.name}` })}
      </text>
      <box
        onMouseUp={props.onHome}
        backgroundColor={theme.background.action.primary.hovered}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.text.action.primary.hovered}>{language.t("tui.dialogs.goHome")}</text>
      </box>
    </box>
  )
}
