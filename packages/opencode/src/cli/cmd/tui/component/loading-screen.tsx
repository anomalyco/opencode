import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useMode } from "@tui/context/mode"

export function LoadingScreen(props: { message: string }) {
  const dimensions = useTerminalDimensions()
  const mode = useMode()
  const isLight = mode === "light"
  const bg = isLight ? "#ffffff" : "#0a0a0a"
  const fg = isLight ? "#8a8a8a" : "#808080"
  const textColor = isLight ? "#1a1a1a" : "#eeeeee"

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={bg}
      justifyContent="center"
      alignItems="center"
      flexDirection="column"
    >
      <text fg={textColor} attributes={TextAttributes.BOLD}>
        opencode
      </text>
      <box paddingTop={1}>
        <text fg={fg}>{props.message}</text>
      </box>
    </box>
  )
}
