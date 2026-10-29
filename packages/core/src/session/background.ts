export * as SessionBackground from "./background.js"

import { Effect } from "effect"
import type { Job } from "../job.js"
import type { SessionSchema } from "./schema.js"
import type { SessionStore } from "./store.js"

/**
 * Background jobs still running for a Session or any of its descendants. A child's own
 * background shell counts even after the child reported to its parent: its notice wakes
 * the child again, so the child's work is not finished.
 */
export const outstanding = Effect.fnUntraced(function* (
  jobs: Pick<Job.Interface, "runningBackground">,
  store: Pick<SessionStore.Interface, "get">,
  sessionID: SessionSchema.ID,
) {
  const owned = yield* Effect.filter(yield* jobs.runningBackground, (recovery) =>
    descends(store, recovery.kind === "shell" ? recovery.sessionID : recovery.parentSessionID, sessionID),
  )
  return owned.map((recovery) =>
    recovery.kind === "shell"
      ? {
          kind: "shell" as const,
          sessionID: recovery.sessionID,
          shellID: recovery.shellID,
          command: recovery.command,
        }
      : {
          kind: "subagent" as const,
          sessionID: recovery.parentSessionID,
          childSessionID: recovery.childSessionID,
          agent: recovery.agent,
          description: recovery.description,
        },
  )
})

const descends = Effect.fnUntraced(function* (
  store: Pick<SessionStore.Interface, "get">,
  from: SessionSchema.ID,
  ancestor: SessionSchema.ID,
) {
  const seen = new Set<SessionSchema.ID>()
  let current: SessionSchema.ID | undefined = from
  while (current !== undefined && !seen.has(current)) {
    if (current === ancestor) return true
    seen.add(current)
    current = (yield* store.get(current))?.parentID
  }
  return false
})
