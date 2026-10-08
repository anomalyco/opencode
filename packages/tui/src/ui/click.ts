import { MouseButton } from "@opentui/core"

type Pointer = {
  x: number
  y: number
  button: number
  target?: { ctx: { getSelection(): { getSelectedText(): string } | null } } | null
}

// Mouse handlers that run an action on a plain left click. A press dragged off
// its cell, or one that ended up selecting text, is a selection rather than a
// click, so drag-to-copy and drag-to-reorder keep working on the same element.
export function onClick(run: () => void) {
  let press: { x: number; y: number } | undefined
  return {
    onMouseDown: (event: Pointer) => {
      press = event.button === MouseButton.LEFT ? { x: event.x, y: event.y } : undefined
    },
    onMouseUp: (event: Pointer) => {
      const same = press?.x === event.x && press.y === event.y
      press = undefined
      if (!same || event.target?.ctx.getSelection()?.getSelectedText()) return
      run()
    },
  }
}
