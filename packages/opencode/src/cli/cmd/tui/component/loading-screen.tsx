import { useTerminalDimensions } from "@opentui/solid"
import { useMode } from "@tui/context/mode"
import { Logo } from "@tui/component/logo"
import { getDefaultColors } from "@tui/default-colors"

export function LoadingScreen(props: { message: string }) {
  const dimensions = useTerminalDimensions()
  const mode = useMode()
  const colors = getDefaultColors(mode)

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.background}
      justifyContent="center"
      alignItems="center"
      flexDirection="column"
    >
      <Logo />
      <box paddingTop={1}>
        <text fg={colors.textMuted}>{props.message}</text>
      </box>
    </box>
  )
}
