export * as SessionBackground from "./background.js"

import type { Kind, Status } from "@opencode/schema/job"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import type { Job } from "../job.js"
import { SessionInbox } from "./inbox.js"
import type { SessionSchema } from "./schema.js"
import type { SessionStore } from "./store.js"

export type Lookup = {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<{ readonly parentID?: SessionSchema.ID } | undefined>
}

export type ListFilter = {
  readonly sessionID?: SessionSchema.ID
  readonly kind?: Kind
  readonly status?: Status
  readonly descendants?: boolean
}

/**
 * Background jobs still running for a Session or any of its descendants. A child's own
 * background shell counts even after the child reported to its parent: its notice wakes
 * the child again, so the child's work is not finished.
 */
export const outstanding = Effect.fnUntraced(function* (
  jobs: Pick<Job.Interface, "runningBackground">,
  store: Lookup,
  sessionID: SessionSchema.ID,
) {
  const parents = new Map<SessionSchema.ID, SessionSchema.ID | null>()
  const owned = yield* Effect.filter(yield* jobs.runningBackground, (recovery) =>
    descends(store, parents, recovery.kind === "subagent" ? recovery.parentSessionID : recovery.sessionID, sessionID),
  )
  return owned.map((recovery) => {
    if (recovery.kind === "shell")
      return {
        kind: "shell" as const,
        sessionID: recovery.sessionID,
        shellID: recovery.shellID,
        command: recovery.command,
      }
    if (recovery.kind === "image")
      return { kind: "image" as const, sessionID: recovery.sessionID, path: recovery.path, model: recovery.model }
    return {
      kind: "subagent" as const,
      sessionID: recovery.parentSessionID,
      childSessionID: recovery.childSessionID,
      agent: recovery.agent,
      description: recovery.description,
    }
  })
})

/**
 * Whether an idle Session will be woken again by its own work: a background job of its own or a
 * descendant's still running, completion notices awaiting admission, or admitted input not yet
 * delivered. A subagent's report waits for this so it carries the child's final state.
 */
export const unsettled = Effect.fnUntraced(function* (
  jobs: Pick<Job.Interface, "runningBackground" | "pendingBackground">,
  store: Lookup & Pick<SessionStore.Interface, "message">,
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
) {
  if ((yield* outstanding(jobs, store, sessionID)).length > 0) return true
  // A job can finish before its observer admits the completion input. Keep that gap pending,
  // but ignore markers whose input was already delivered (observer cleanup may lag behind it).
  const parents = new Map<SessionSchema.ID, SessionSchema.ID | null>()
  for (const job of yield* jobs.pendingBackground) {
    const owner = job.recovery.kind === "subagent" ? job.recovery.parentSessionID : job.recovery.sessionID
    if (!(yield* descends(store, parents, owner, sessionID))) continue
    if (!(yield* store.message(job.notificationID))) return true
  }
  return yield* SessionInbox.has(db, sessionID, "input")
})

/** Active and unconsumed background jobs matching the requested Session, kind, status, and descendant scope. */
export const list = Effect.fn("SessionBackground.list")(function* (
  jobs: Pick<Job.Interface, "backgroundJobs">,
  store: Lookup,
  filter: ListFilter = {},
) {
  const items = (yield* jobs.backgroundJobs).filter(
    (item) =>
      (filter.kind === undefined || item.kind === filter.kind) &&
      (filter.status === undefined || item.status === filter.status),
  )
  if (filter.sessionID === undefined) return items
  const sessionID = filter.sessionID
  if (!filter.descendants) return items.filter((item) => item.sessionID === sessionID)
  const parents = new Map<SessionSchema.ID, SessionSchema.ID | null>()
  return yield* Effect.filter(items, (item) => descends(store, parents, item.sessionID, sessionID))
})

const descends = Effect.fnUntraced(function* (
  store: Lookup,
  parents: Map<SessionSchema.ID, SessionSchema.ID | null>,
  from: SessionSchema.ID,
  ancestor: SessionSchema.ID,
) {
  const seen = new Set<SessionSchema.ID>()
  let current: SessionSchema.ID | undefined = from
  while (current !== undefined && !seen.has(current)) {
    if (current === ancestor) return true
    seen.add(current)
    const cached = parents.get(current)
    if (cached !== undefined) {
      current = cached ?? undefined
      continue
    }
    const parentID = (yield* store.get(current))?.parentID
    parents.set(current, parentID ?? null)
    current = parentID
  }
  return false
})
