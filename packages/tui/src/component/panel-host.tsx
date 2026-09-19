import type { BoxRenderable } from "@opentui/core"
import { onCleanup, onMount } from "solid-js"
import { usePanel, type PanelTarget } from "../context/panel"
import { InteractivityProvider } from "../context/interactivity"
import { useTheme } from "../context/theme"
import { Slot } from "../plugin/render"

export function PanelHost(props: {
  panel: PanelTarget
  width: number
  focused: boolean
  onFocus: () => void
  onTarget: (node: BoxRenderable | undefined) => void
}) {
  const panels = usePanel()
  let node: BoxRenderable
  onMount(() => props.onTarget(node))
  onCleanup(() => props.onTarget(undefined))

  const Content = () => {
    const theme = useTheme()
    // Side panels sit on a raised surface; fullscreen takes over the base background.
    const background = () =>
      panels.presentation() === "panel" ? theme.background.raised.base : theme.background.base
    return (
      <box
        id="session-panel"
        ref={(value: BoxRenderable) => (node = value)}
        flexGrow={1}
        minWidth={0}
        minHeight={0}
        focusable
        backgroundColor={background()}
        onMouseDown={props.onFocus}
      >
        <Slot
          path="session.panel"
          input={{
            name: props.panel.name,
            sessionID: props.panel.sessionID,
            get width() {
              return props.width
            },
            get presentation() {
              return panels.presentation()
            },
            get focused() {
              return props.focused
            },
            focus: props.onFocus,
            close: panels.close,
            toggleFullscreen: panels.toggleFullscreen,
          }}
        />
      </box>
    )
  }

  return (
    <InteractivityProvider enabled={props.focused}>
      <Content />
    </InteractivityProvider>
  )
}
