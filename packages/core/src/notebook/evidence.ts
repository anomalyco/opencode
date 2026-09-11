export * as NotebookEvidence from "./evidence"

const NUDGE_COOLDOWN = 10 * 60_000
const SESSION_CAP = 40

type Evidence = {
  dirty: boolean
  lastNudge: number
}

const sessions = new Map<string, Evidence>()

function evidence(sessionID: string): Evidence {
  if (sessions.size >= SESSION_CAP) {
    const first = sessions.keys().next().value
    if (first) sessions.delete(first)
  }
  let entry = sessions.get(sessionID)
  if (!entry) {
    entry = { dirty: false, lastNudge: 0 }
    sessions.set(sessionID, entry)
  }
  return entry
}

/** Record that a session explored the repository (so it should eventually save). */
export function markExplore(sessionID: string) {
  evidence(sessionID).dirty = true
}

/** Record that a session committed its learnings, which silences the nudge. */
export function markCommitted(sessionID: string) {
  evidence(sessionID).dirty = false
}

/** Whether the session has explored (or committed) something since it started tracking. */
export function isDirty(sessionID: string): boolean {
  return sessions.get(sessionID)?.dirty ?? false
}

/** Returns a save-reminder for the agent, honoring a cooldown between nudges. */
export function nudgeFor(sessionID: string): string | undefined {
  const entry = sessions.get(sessionID)
  if (!entry || !entry.dirty || Date.now() - entry.lastNudge < NUDGE_COOLDOWN) return undefined
  entry.lastNudge = Date.now()
  return [
    "## Save your learnings",
    "You explored the repository and have not saved learnings yet.",
    "When you finish the current task — including a pure explanation or Q&A — call `notes_commit` with the durable takeaways.",
    "The user will approve or reject the change (a diff is shown). Only call it when there is something worth remembering.",
  ].join("\n")
}
