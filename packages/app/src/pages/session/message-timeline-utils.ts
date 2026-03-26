import type { JSX } from "solid-js"

export function virtualize(input: { desktop: boolean; count: number; working: boolean }) {
  return input.desktop && input.count > 6 && !input.working
}

export function captureScroll(input: { scrollTop: number; scrollHeight: number; clientHeight: number; threshold?: number }) {
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

export function itemStyle(centered: boolean): JSX.CSSProperties {
  if (!centered) return {}
  return {
    "max-width": "var(--session-content-width, 60rem)",
    "margin-left": "auto",
    "margin-right": "auto",
  }
}
