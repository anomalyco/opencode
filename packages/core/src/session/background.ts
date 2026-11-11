export * as SessionBackground from "./background.js"

import type { Kind, Status } from "@opencode/schema/job"
import { Effect } from "effect"
import type { Job } from "../job.js"
import type { SessionSchema } from "./schema.js"

export type Lookup = {
  readonly get: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<
    { readonly parentID?: SessionSchema.ID; readonly agent?: string; readonly title?: string } | undefined
  >
}

export type OutstandingItem =
  | {
      readonly kind: "shell"
      readonly sessionID: SessionSchema.ID
      readonly shellID: string
      readonly command: string
    }
  | {
      readonly kind: "image"
      readonly sessionID: SessionSchema.ID
      readonly model: string
      readonly path: string
    }
  | {
      readonly kind: "subagent"
      readonly sessionID: SessionSchema.ID
      readonly childSessionID: SessionSchema.ID
      readonly agent: string
      readonly description: string
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
 *
 * `active` adds executions that hold a claim right now, such as a subagent mid-turn
 * whose Job record already settled. Only descendants are added, and a child already
 * represented by a running background job is not repeated.
 */
export const outstanding = Effect.fnUntraced(function* (
  jobs: Pick<Job.Interface, "runningBackground"> & { readonly get?: Job.Interface["get"] },
  store: Lookup,
  sessionID: SessionSchema.ID,
  active?: ReadonlySet<SessionSchema.ID>,
) {
  const parents = new Map<SessionSchema.ID, SessionSchema.ID | null>()
  const owned = yield* Effect.filter(yield* jobs.runningBackground, (recovery) =>
    descends(store, parents, recovery.kind === "subagent" ? recovery.parentSessionID : recovery.sessionID, sessionID),
  )
  const items: OutstandingItem[] = owned.map((recovery) => {
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
  if (!active || active.size === 0) return items
  const children = new Set(items.flatMap((item) => (item.kind === "subagent" ? [item.childSessionID] : [])))
  for (const activeID of active) {
    if (activeID === sessionID || children.has(activeID)) continue
    // Foreground-blocking work is the caller's inline result, and cancelled work is
    // acknowledged elsewhere: neither is still running for this report.
    const tracked = jobs.get ? yield* jobs.get(activeID) : undefined
    if (
      tracked &&
      ((tracked.status === "running" && tracked.notificationID === undefined) || tracked.status === "cancelled")
    )
      continue
    if (!(yield* descends(store, parents, activeID, sessionID))) continue
    const info = yield* store.get(activeID)
    if (!info?.parentID) continue
    items.push({
      kind: "subagent",
      sessionID: info.parentID,
      childSessionID: activeID,
      agent: info.agent ?? "subagent",
      description: info.title ?? "Subagent",
    })
  }
  return items
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
