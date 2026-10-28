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
// The release goes to the action, and what the action returns comes back from
// onMouseUp, so a handler sharing an element can tell whether it ran.
export function onClick<E extends Pointer, R>(run: (event: E) => R) {
  let press: { x: number; y: number } | undefined
  return {
    onMouseDown: (event: E) => {
      press = event.button === MouseButton.LEFT ? { x: event.x, y: event.y } : undefined
    },
    onMouseUp: (event: E) => {
      const same = press?.x === event.x && press.y === event.y
      press = undefined
      if (!same || event.target?.ctx.getSelection()?.getSelectedText()) return
      return run(event)
    },
  }
}

// Copies text the TUI drew and says so, the way a drag-copy does.
export function copyText(
  clipboard: { write?(text: string): Promise<void> },
  toast: (input: { message: string; variant: "info" | "error" }) => void,
  text: string,
  label = text,
) {
  clipboard
    .write?.(text)
    .then(() => toast({ message: `Copied ${label}`, variant: "info" }))
    .catch(() => toast({ message: "Failed to copy to clipboard", variant: "error" }))
}
