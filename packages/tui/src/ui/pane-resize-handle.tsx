import { useTheme } from "../context/theme"
import type { createPaneResize } from "./pane-resize"

export function PaneResizeHandle(props: {
  resize: ReturnType<typeof createPaneResize>
  left: number
  highlight?: "left" | "right"
}) {
  const theme = useTheme("elevated")

  return (
    <box
      position="absolute"
      left={props.left}
      top={0}
      zIndex={10}
      width={2}
      height="100%"
      onMouseOver={props.resize.onMouseOver}
      onMouseOut={props.resize.onMouseOut}
      onMouseDown={props.resize.onMouseDown}
    >
      <box
        width={1}
        height="100%"
        marginLeft={props.highlight === "right" ? 1 : 0}
        backgroundColor={
          props.resize.hovered() || props.resize.resizing() ? theme.background.action.primary.hovered : undefined
        }
      />
    </box>
  )
}
