import { MouseButton } from "@opentui/core"
import { useRenderer, type JSX } from "@opentui/solid"
import { openUrl } from "@opencode/util/open"

export function Markdown(props: Omit<JSX.IntrinsicElements["markdown"], "onMouseDown" | "onMouseUp" | "onMouseDrag">) {
  const renderer = useRenderer()
  let pressed: string | null = null

  return (
    <markdown
      {...props}
      onMouseDown={(event) => {
        pressed = null
        if (event.defaultPrevented || event.button !== MouseButton.LEFT || event.modifiers.shift || event.modifiers.alt)
          return
        pressed = renderer.getLinkAt(event.x, event.y)
      }}
      onMouseDrag={() => {
        pressed = null
      }}
      onMouseUp={(event) => {
        const href = pressed
        pressed = null
        const selection = renderer.getSelection()
        if (
          !href ||
          event.defaultPrevented ||
          event.button !== MouseButton.LEFT ||
          (selection && (!selection.isStart || selection.behavior !== "cell")) ||
          event.modifiers.shift ||
          event.modifiers.alt ||
          renderer.getLinkAt(event.x, event.y) !== href
        )
          return
        // Mouse reporting can consume the terminal's native hyperlink gesture.
        event.stopPropagation()
        openUrl(href).catch(() => {})
      }}
    />
  )
}
