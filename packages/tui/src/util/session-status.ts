import type { RGBA } from "@opentui/core"
import { tint } from "../theme"

// Per-session status shown on the cross-project sessions list. Colors age
// with the time since the status last changed: fresh states use the strong
// token, mid-age states fade towards the background, and old states mute.
export type StatusType = "needs_input" | "retrying" | "working" | "done" | "interrupted"

export interface PersistedStatus {
  status: "working" | "retrying" | "needs_input" | "done" | "idle"
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
const FRESH_INPUT = 10 * MINUTE
const OLD_INPUT = 4 * 60 * MINUTE
const FRESH_DONE = 5 * MINUTE
const DONE_EXPIRY = 30 * MINUTE
const LONG_WORK = 60 * MINUTE

// Runtime signals win over the persisted row: they are live for the whole
// process thanks to the global event stream. A persisted active status older
// than this process means its writer died with it — drains are process-local.
export function resolveStatus(input: {
  persisted?: PersistedStatus
  runtime?: "idle" | "busy" | "retry"
  pendingInput?: boolean
  bootTime: number
}): StatusType | undefined {
  if (input.pendingInput) return "needs_input"
  if (input.runtime === "retry") return "retrying"
  if (input.runtime === "busy") return "working"
  const persisted = input.persisted
  if (!persisted) return undefined
  if (persisted.status === "needs_input") return "needs_input"
  if (persisted.status === "done") return "done"
  if (persisted.status === "working" || persisted.status === "retrying") {
    return persisted.time.updated < input.bootTime ? "interrupted" : persisted.status
  }
  return undefined
}

export function statusDisplay(status: StatusType, timeChanged: number, now: number, theme: StatusTheme) {
  const age = now - timeChanged
  switch (status) {
    case "needs_input":
      return {
        label: "Needs input",
        color:
          age < FRESH_INPUT
            ? theme.warning
            : age < OLD_INPUT
              ? tint(theme.background, theme.warning, 0.55)
              : theme.textMuted,
      }
    case "retrying":
      return { label: "Retrying", color: theme.error }
    case "working":
      return { label: "Working", color: age < LONG_WORK ? theme.primary : theme.textMuted }
    case "done":
      if (age > DONE_EXPIRY) return undefined
      return {
        label: "Done",
        color: age < FRESH_DONE ? theme.success : tint(theme.background, theme.success, 0.55),
      }
    case "interrupted":
      return { label: "Interrupted", color: theme.textMuted }
  }
}
