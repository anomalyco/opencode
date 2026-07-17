import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

export function Reconnecting() {
  const { themeV2 } = useTheme()

  return (
    <box
      position="absolute"
      zIndex={10_000}
      top={0}
      right={0}
      bottom={0}
      left={0}
      backgroundColor={themeV2.background()}
      alignItems="center"
      justifyContent="center"
    >
      <box width={62} maxWidth="90%" flexDirection="column" alignItems="center" gap={1}>
        <Spinner color={themeV2.text.subdued()}>Waiting for background service...</Spinner>
      </box>
    </box>
  )
}
