import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useTheme } from "../context/theme"
import type { createPaneResize } from "./pane-resize"

export function PaneResizeHandle(props: {
  resize: ReturnType<typeof createPaneResize>
  left: number
  highlight?: "left" | "right"
}) {
  const theme = useTheme()
  const renderer = useRenderer()
  const active = createMemo(() => props.resize.hovered() || props.resize.resizing())
  const [row, setRow] = createSignal(0)
  let handle: BoxRenderable | undefined
  // The grip follows the pointer while hovering and keeps the row a drag started on.
  const follow = (event: MouseEvent) => {
    if (props.resize.resizing()) return
    setRow(event.y - (handle?.y ?? 0))
    renderer.requestRender()
  }

  // Show the terminal's resize pointer while hovering or dragging, as GUI split panes do, and repaint
  // the line and grip, which no prop change would redraw.
  createEffect(
    on(
      active,
      (value) => {
        renderer.setMousePointer(value ? "ew-resize" : "default")
        renderer.requestRender()
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    if (active()) renderer.setMousePointer("default")
  })

  return (
    <box
      ref={(element) => (handle = element)}
      position="absolute"
      left={props.left}
      top={0}
      zIndex={10}
      width={2}
      height="100%"
      onMouseOver={(event) => {
        follow(event)
        props.resize.onMouseOver()
      }}
      onMouseMove={follow}
      onMouseOut={props.resize.onMouseOut}
      onMouseDown={(event) => {
        follow(event)
        props.resize.onMouseDown(event)
      }}
      // One element paints both the line and, for terminals that cannot show the resize pointer, a grip
      // mark: child elements would take the hover from the handle as the pointer crosses them.
      renderAfter={function (buffer) {
        if (!active()) return
        const x = this.x + (props.highlight === "right" ? 1 : 0)
        buffer.fillRect(x, this.y, 1, this.height, theme.background.raised.high)
        buffer.drawText("⋮", x, this.y + row(), theme.text.action.primary.base, theme.background.raised.high)
      }}
    />
  )
}
