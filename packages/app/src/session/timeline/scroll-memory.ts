/** Where a session's timeline sat when its view went away. */
export type TimelineScrollMemory = {
  /** The row at the viewport top. */
  readonly anchorKey?: string
  /** The viewport top relative to that row's top, so a row that grew above it keeps the offset. */
  readonly delta?: number
  /** Whether the view was following the newest content. */
  readonly following?: boolean
}

// Views are cached per session (16 of them, see createTimelineCache), so this is a little larger to cover the sessions
// a reader moves between without keeping every session they ever opened.
const LIMIT = 64

const memory = new Map<string, TimelineScrollMemory>()

/** The row under the viewport top, and how far its top sits above or below it. */
export function anchorAt(
  items: readonly { readonly key: string | number | bigint; readonly start: number; readonly end: number }[],
  offset: number,
) {
  const item = items.find((item) => item.end > offset) ?? items.at(-1)

  if (!item) return

  return { anchorKey: String(item.key), delta: item.start - offset }
}

export function rememberScroll(key: string, patch: TimelineScrollMemory) {
  const previous = memory.get(key)
  const next = { ...previous, ...patch }

  // Re-insert so the entry counts as the most recent one the reader looked at.
  memory.delete(key)
  memory.set(key, next)

  while (memory.size > LIMIT) {
    const oldest = memory.keys().next().value

    if (oldest === undefined) return
    memory.delete(oldest)
  }
}

export function recallScroll(key: string) {
  return memory.get(key)
}

export function forgetScroll(key: string) {
  memory.delete(key)
}
