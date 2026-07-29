import { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

export function Reconnecting() {
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
        <Spinner color={theme.text.default}>Restarting service...</Spinner>
        <text fg={theme.text.subdued}>Your session will resume automatically.</text>
      </box>
    </box>
  )
}
