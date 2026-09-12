import { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"
import { useLanguage } from "../context/language"

export function Reconnecting(props: { managed?: boolean }) {
  const language = useLanguage()
  const theme = useTheme("elevated")

  return (
    <box
      position="absolute"
      zIndex={10_000}
      top={0}
      right={0}
      bottom={0}
      left={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={48}
        maxWidth="90%"
        flexDirection="column"
        backgroundColor={theme.background.default}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
      >
        <Spinner color={theme.text.default}>
          {language.t(props.managed ? "tui.restartingService" : "tui.dialogs.connectionLost")}
        </Spinner>
        <text fg={theme.text.subdued}>
          {props.managed
            ? language.t("tui.dialogs.resumeAutomatically")
            : language.t("tui.dialogs.reconnectAutomatically")}
        </text>
      </box>
    </box>
  )
}
