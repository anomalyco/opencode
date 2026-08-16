import { useTheme } from "../context/theme"

export function PluginRouteMissing(props: { id: string; onHome: () => void }) {
  const { theme } = useTheme()

  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
      <text fg={theme.warning}>Unknown plugin route: {props.id}</text>
      <box onMouseUp={props.onHome} backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
        <text fg={theme.text}>go home</text>
      </box>
    </box>
  )
}
