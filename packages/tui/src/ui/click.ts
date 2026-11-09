import type { CliRenderer, MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/solid"

const LEFT_MOUSE_BUTTON = 0

/**
 * Returns whether a mouse release is a plain click. opentui marks the release that ends a
 * selection gesture with `isDragging`, and a fresh "cell" selection means the pointer never
 * moved off its cell; other releases, such as the end of a drag that selected text, are not
 * clicks. Releases with ctrl/alt/shift held are left to the terminal's own handling.
 */
export function isPlainClick(renderer: CliRenderer, event: MouseEvent) {
  if (!event.isDragging || event.modifiers.ctrl || event.modifiers.alt || event.modifiers.shift) return false
  const selection = renderer.getSelection()
  return !!selection?.isStart && selection.behavior === "cell"
}

// Mouse handlers that run an action on a plain left click (see isPlainClick), so
// drag-to-select keeps working on the same element.
export function onClick(run: () => void) {
  const renderer = useRenderer()
  return {
    onMouseUp: (event: MouseEvent) => {
      if (event.button !== LEFT_MOUSE_BUTTON || !isPlainClick(renderer, event)) return
      run()
    },
  }
}
