import type { JSX } from "solid-js"

export function virtualize(input: { desktop: boolean; count: number; working: boolean }) {
  return input.desktop && input.count > 6 && !input.working
}

export function itemStyle(centered: boolean): JSX.CSSProperties {
  if (!centered) return {}
  return {
    "max-width": "var(--session-content-width, 60rem)",
    "margin-left": "auto",
    "margin-right": "auto",
  }
}
