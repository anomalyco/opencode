import type { OpenCodeEvent } from "@opencode/client/promise"
import { mergeHomeSessionIndex } from "@/home/sessions/index"

// Events that keep a preview tab. This is deliberately separate from recency: opening or passively updating a
// session must not turn its preview into a permanent tab.
const activityTypes = [
  "session.inbox.enqueued",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.renamed",
  "session.moved",
  "session.archived",
  "session.unarchived",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
] as const satisfies OpenCodeEvent["type"][]

export function isSidebarSessionActivity(
  event: OpenCodeEvent,
): event is Extract<OpenCodeEvent, { type: (typeof activityTypes)[number] }> {
  return activityTypes.some((type) => type === event.type)
}

// Loading a tab refreshes its metadata, not its place in the project list. A newer idle marker means a run ended
// after the index was fetched, which is the one server change that may move the session. Recency overrides are
// applied afterward by the shared desktop data layer, which also owns send promotion and the rename guard.
export const mergeSidebarSessions = mergeHomeSessionIndex
