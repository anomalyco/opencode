import type { JSX } from "solid-js"

export function virtualize(input: { desktop: boolean; count: number; working: boolean }) {
  return input.desktop && input.count > 6 && !input.working
}

export function pickPin(input: {
  viewTop: number
  viewBottom: number
  line?: number
  items: Array<{
    id: string
    top: number
    bottom: number
  }>
}) {
  const line = input.line ?? input.viewTop + 100
  const shown = input.items.filter((item) => item.bottom > input.viewTop && item.top < input.viewBottom)
  const hit =
    shown.find((item) => item.top <= line && item.bottom >= line) ??
    [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0] ??
    input.items.filter((item) => item.top <= line).at(-1) ??
    input.items[0]
  if (!hit) return
  return {
    id: hit.id,
    top: hit.top - input.viewTop,
  }
}

export function captureScroll(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  threshold?: number
}) {
  const max = Math.max(0, input.scrollHeight - input.clientHeight)
  const top = Math.max(0, Math.min(input.scrollTop, max))
  const gap = Math.max(0, max - top)
  return {
    top,
    gap,
    bottom: gap <= (input.threshold ?? 16),
  }
}

export function restoreScroll(input: {
  top: number
  gap: number
  bottom: boolean
  scrollHeight: number
  clientHeight: number
}) {
  const max = Math.max(0, input.scrollHeight - input.clientHeight)
  if (input.bottom) return Math.max(0, max - Math.max(0, input.gap))
  return Math.max(0, Math.min(input.top, max))
}

export function restorePinnedTop(input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  pinTop: number
  nextTop: number
}) {
  const max = Math.max(0, input.scrollHeight - input.clientHeight)
  const next = input.scrollTop + input.nextTop - input.pinTop
  return Math.max(0, Math.min(next, max))
}

export function virtualizeTop(input: {
  follow: boolean
  top: number
  gap: number
  bottom: boolean
  scrollHeight: number
  clientHeight: number
}) {
  // During a non-virtual <-> virtual flip the old scroll container can briefly
  // report a stale top (including `0`). If the timeline is following the latest
  // turn, restore against the new bottom instead of reusing that stale top.
  if (input.follow) return Math.max(0, input.scrollHeight - input.clientHeight)
  return restoreScroll(input)
}

export function itemStyle(centered: boolean): JSX.CSSProperties {
  if (!centered) return {}
  return {
    "max-width": "var(--session-content-width, 60rem)",
    "margin-left": "auto",
    "margin-right": "auto",
  }
}
