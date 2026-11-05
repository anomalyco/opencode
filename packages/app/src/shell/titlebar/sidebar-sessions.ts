import type { OpenCodeEvent, SessionInfo } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import { mergeHomeSessionIndex } from "@/home/sessions/index"

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

// Passive metadata and agent/model selection sync must not promote a session just because it was opened.
export function isSidebarSessionActivity(
  event: OpenCodeEvent,
): event is Extract<OpenCodeEvent, { type: (typeof activityTypes)[number] }> {
  return activityTypes.some((type) => type === event.type)
}

export function createSidebarSessionActivity() {
  const [activity, setActivity] = createStore<Record<string, Record<string, number | undefined>>>({})

  return {
    get(server: string, sessionId: string) {
      return activity[server]?.[sessionId]
    },
    update(server: string, event: OpenCodeEvent) {
      if (!isSidebarSessionActivity(event)) return
      setActivity(server, (sessions) => ({
        ...sessions,
        [event.data.sessionID]: Math.max(sessions?.[event.data.sessionID] ?? 0, event.created),
      }))

      return event
    },
  }
}

// Loading a tab refreshes its metadata, not its place in the project list. Activity events are applied afterward.
export function mergeSidebarSessions(
  indexed: SessionInfo[],
  known: SessionInfo[],
  activity: (id: string) => number | undefined,
) {
  const timestamps = new Map(indexed.map((session) => [session.id, session.time.updated]))

  return mergeHomeSessionIndex(
    indexed,
    known.map((session) => {
      const updated = timestamps.get(session.id)

      return updated === undefined ? session : { ...session, time: { ...session.time, updated } }
    }),
  ).map((session) => {
    const updated = activity(session.id)

    return updated !== undefined && updated > session.time.updated
      ? { ...session, time: { ...session.time, updated } }
      : session
  })
}
