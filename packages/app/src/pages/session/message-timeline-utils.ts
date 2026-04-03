import type { JSX } from "solid-js"

export function itemStyle(centered: boolean): JSX.CSSProperties {
  if (!centered) return {}
  return {
    "max-width": "var(--session-content-width, 60rem)",
    "margin-left": "auto",
    "margin-right": "auto",
  }
}
