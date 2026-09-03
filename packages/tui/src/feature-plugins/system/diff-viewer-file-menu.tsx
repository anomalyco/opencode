/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode-ai/plugin/tui"
import { BoxRenderable, MouseButton } from "@opentui/core"
import { Portal, useTerminalDimensions } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"

export function DiffFileMenu(props: {
  context: Plugin.Context
  state: { fileIndex: number; x: number; y: number }
  reviewed: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme.contextual.overlay
  const [hovered, setHovered] = createSignal(false)
  const label = () => (props.reviewed ? "Mark incomplete" : "Mark complete")
  const width = () => Math.min(19, dimensions().width)
  const run = () => {
    props.onClose()
    props.onToggle()
  }
  onCleanup(props.context.keymap.mode.push("menu"))
  props.context.keymap.layer(() => ({
    mode: "menu",
    commands: [
      { bind: "escape,ctrl+c", title: "Close file menu", group: "Diff", run: props.onClose },
      { bind: "return", title: label(), group: "Diff", run },
    ],
  }))

  return (
    <Portal
      ref={(container) => {
        if (!(container instanceof BoxRenderable)) return
        // Portal's wrapper must also escape root flow, not follow the full-height app.
        container.position = "absolute"
        container.left = 0
        container.top = 0
        container.zIndex = 2600
      }}
    >
      <box
        id="diff-file-menu-overlay"
        position="absolute"
        left={0}
        top={0}
        width={dimensions().width}
        height={dimensions().height}
        zIndex={2600}
        onMouseDown={(event) => {
          props.onClose()
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <box
          id="diff-file-menu"
          position="absolute"
          left={Math.max(0, Math.min(props.state.x, dimensions().width - width()))}
          top={Math.max(0, Math.min(props.state.y + 1, dimensions().height - 1))}
          width={width()}
          height={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={hovered() ? theme.background.action.primary.hovered : theme.background.default}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onMouseDown={(event) => {
            if (event.button === MouseButton.RIGHT) props.onClose()
            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseUp={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (event.button === MouseButton.LEFT) run()
          }}
        >
          <text fg={theme.text.default} selectable={false} wrapMode="none" truncate>
            {label()}
          </text>
        </box>
      </box>
    </Portal>
  )
}
