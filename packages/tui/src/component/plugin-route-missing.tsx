import { useTheme } from "../context/theme"

export function PluginRouteMissing(props: { id: string; name: string; onHome: () => void }) {
  const { themeV2 } = useTheme()

  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
      <text fg={themeV2.text.feedback.warning()}>
        Unknown plugin route: {props.id}/{props.name}
      </text>
      <box
        onMouseUp={props.onHome}
        backgroundColor={themeV2.background.action("hovered")}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={themeV2.text.action("hovered")}>go home</text>
      </box>
    </box>
  )
}
