import { SessionStatusStore } from "@opencode-ai/core/session/status-store"

// The status table is shared by every opencode process on this machine, so an
// active row is only trustworthy while its writer process is alive. Rows with
// no PID predate the column; their writers came from older builds that had to
// be restarted to run this code, so they count as dead.
function pidAlive(pid: number | null) {
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH means gone; anything else (EPERM, platform quirks) means it exists.
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

// Derive the effective status of a stored row from the liveness of its
// writer: a dead writer mid-turn becomes "interrupted", and a dead writer
// holding a question/permission is just idle (nothing is actually waiting).
export function deriveWriterStatus(row: SessionStatusStore.Row): SessionStatusStore.Info {
  const base = { sessionID: row.sessionID, detail: row.detail, time: row.time }
  if (row.status !== "working" && row.status !== "retrying" && row.status !== "needs_input") {
    return { ...base, status: row.status }
  }
  if (pidAlive(row.pid)) return { ...base, status: row.status }
  // Details (question headers, retry counters) describe the dead state, so
  // they are dropped along with it.
  return { sessionID: row.sessionID, status: row.status === "needs_input" ? "idle" : "interrupted", time: row.time }
}

export * as SessionStatusDerive from "./status-derive"
