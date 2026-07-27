import type { RGBA } from "@opentui/core"
import { tint } from "../theme"

// Per-session status shown on the cross-project sessions list. Colors age
// with the time since the status last changed, in three "cache heat" bands:
// fresh (<5min, likely still inside the provider's prompt-cache TTL) uses the
// strong token, warm (5–60min, the extended-cache window) fades towards the
// background, and cold (>60min) mutes.
export type StatusType = "needs_input" | "waiting" | "retrying" | "working" | "done" | "interrupted"

export interface PersistedStatus {
  status: "working" | "retrying" | "needs_input" | "waiting" | "done" | "idle" | "interrupted"
  detail?: string
  time: { created: number; updated: number }
}

export interface StatusTheme {
  primary: RGBA
  warning: RGBA
  error: RGBA
  success: RGBA
  textMuted: RGBA
  background: RGBA
}

const MINUTE = 60_000
const HOT = 5 * MINUTE
const COLD = 60 * MINUTE
const DONE_EXPIRY = 30 * MINUTE

// Runtime signals win over the persisted row: they are live for the whole
// process thanks to the global event stream. The server already derived
// "interrupted" for persisted active rows whose writer process died, so the
// persisted row can be trusted as-is here.
export function resolveStatus(input: {
  persisted?: PersistedStatus
  runtime?: "idle" | "busy" | "retry"
  pendingInput?: boolean
}): StatusType | undefined {
  if (input.pendingInput) return "needs_input"
  if (input.runtime === "retry") return "retrying"
  if (input.runtime === "busy") return "working"
  const persisted = input.persisted
  if (!persisted) return undefined
  if (persisted.status === "needs_input") return "needs_input"
  if (persisted.status === "waiting") return "waiting"
  if (persisted.status === "done") return "done"
  if (persisted.status === "interrupted") return "interrupted"
  if (persisted.status === "working" || persisted.status === "retrying") return persisted.status
  return undefined
}

// One display entry per status: the gutter icon and the footer label share
// the same color so the row reads as one signal. needs_input and waiting are
// both "the session needs you" — warning family, told apart by icon/label.
export function statusDisplay(status: StatusType, timeChanged: number, now: number, theme: StatusTheme) {
  const age = now - timeChanged
  const heat = (color: RGBA) => (age < HOT ? color : age < COLD ? tint(theme.background, color, 0.55) : theme.textMuted)
  switch (status) {
    case "needs_input":
      return { label: "Needs input", icon: "!", color: heat(theme.warning) }
    case "waiting":
      return { label: "Waiting", icon: "?", color: heat(theme.warning) }
    case "retrying":
      return { label: "Retrying", icon: "⚠", color: theme.error }
    case "working":
      return { label: "Working", icon: undefined, color: age < COLD ? theme.primary : theme.textMuted }
    case "done":
      if (age > DONE_EXPIRY) return undefined
      return {
        label: "Done",
        icon: "✓",
        color: age < HOT ? theme.success : tint(theme.background, theme.success, 0.55),
      }
    case "interrupted":
      return { label: "Interrupted", icon: "✕", color: theme.textMuted }
  }
}
