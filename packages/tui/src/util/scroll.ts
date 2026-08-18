import { MacOSScrollAccel, type ScrollAcceleration } from "@opentui/core"

export type ScrollConfig = {
  scroll_acceleration?: { enabled?: boolean }
  scroll_speed?: number
}

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function getScrollAcceleration(tuiConfig?: ScrollConfig): ScrollAcceleration {
  if (tuiConfig?.scroll_acceleration?.enabled) {
    return new MacOSScrollAccel()
  }
  if (tuiConfig?.scroll_speed !== undefined) {
    return new CustomSpeedScroll(tuiConfig.scroll_speed)
  }

  return new CustomSpeedScroll(3)
}

export type ScrollChild = {
  id?: string
  y: number
  height: number
}

// The TUI keeps at most 100 messages per session (see `context/sync.tsx`).
// When a new message pushes the session past the limit, the oldest message is
// pruned. The scrollbox holds scrollTop fixed while the user has scrolled up to
// read a backlog, so removing content from the top shifts the reading position
// down the transcript. Given the layout captured *before* the pruned messages
// are removed, this returns the scrollTop that keeps the reading position
// stable: it moves up by the height of the content that disappeared above the
// first surviving message.
export function compensatePruneScrollTop(input: {
  children: ScrollChild[]
  messageIDs: ReadonlySet<string>
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}): number {
  const { children, messageIDs, scrollTop, scrollHeight, viewportHeight } = input
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight)
  // Sticky scroll already keeps the viewport glued to the bottom.
  if (scrollTop >= maxScrollTop - 1) return scrollTop

  // Message boxes carry an id (the top spacer box does not). The oldest
  // surviving message anchors the measurement: everything between it and the
  // content above the oldest message was pruned.
  const messageBoxes = children.filter((child) => child.id !== undefined)
  const oldest = messageBoxes[0]
  if (!oldest || messageIDs.has(oldest.id!)) return scrollTop
  const anchor = messageBoxes.find((child) => child.id !== undefined && messageIDs.has(child.id))
  if (!anchor) return scrollTop

  const index = children.indexOf(oldest)
  const above = children[index - 1]
  if (!above) return scrollTop

  const removedHeight = anchor.y - (above.y + above.height)
  if (removedHeight <= 0) return scrollTop
  return Math.max(0, scrollTop - removedHeight)
}
