export * as SubagentJob from "./subagent-job.js"

import { asc, eq } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Scope, Stream } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Job } from "../job.js"
import { JobTable } from "../job/sql.js"
import { Session } from "../session.js"
import { SessionEvent } from "./event.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionInboxTable } from "./sql.js"
import { SessionStore } from "./store.js"
import { SubagentCompletion } from "./subagent-completion.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

const noticeID = (idleID: SessionMessage.ID) => SessionMessage.ID.make(`${idleID}_subagent`)
const TURN_PAGE = 50

export interface Interface {
  track: (recovery: Recovery) => Effect.Effect<void>
  start: (recovery: Recovery) => Effect.Effect<Job.Info>
  block: <E>(recovery: Recovery, prompt: Effect.Effect<unknown, E>) => Effect.Effect<Job.BlockResult | undefined, E>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
  sync: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  recover: <A, E, R>(
    suspended: ReadonlySet<SessionSchema.ID>,
    prepare: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

const make: Effect.Effect<
  Interface,
  never,
  Database.Service | Session.Service | SessionStore.Service | Job.Service | Bus.Service | Scope.Scope
> = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const sessions = yield* Session.Service
  const store = yield* SessionStore.Service
  const jobs = yield* Job.Service
  const bus = yield* Bus.Service
  const scope = yield* Scope.Scope
  // Jobs and listeners outlive the plugin that launched them, without retaining a caller Location.
  const context = yield* Effect.context<never>()
  const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()
  const notifications = new Set<string>()
  // Holds idle delivery while a synchronous foreground call is waiting on `jobs.block`.
  const foreground = new Map<SessionSchema.ID, number>()
  const settled = new Map<SessionSchema.ID, SessionMessage.ID>()
  const deferredParents = new Set<SessionSchema.ID>()

  const readMarker = (sessionID: SessionSchema.ID) =>
    db
      .select()
      .from(JobTable)
      .where(eq(JobTable.child_session_id, sessionID))
      .get()
      .pipe(
        Effect.map((row) => (row?.recovery.kind === "subagent" ? { ...row, recovery: row.recovery } : undefined)),
        Effect.orDie,
      )

  const updateMarker = (sessionID: SessionSchema.ID, reported: SessionMessage.ID | null, dirty = false) =>
    db
      .update(JobTable)
      .set({ reported, dirty })
      .where(eq(JobTable.child_session_id, sessionID))
      .run()
      .pipe(Effect.orDie)

  const removeMarker = (sessionID: SessionSchema.ID) =>
    db.delete(JobTable).where(eq(JobTable.child_session_id, sessionID)).run().pipe(Effect.orDie)

  const latestIdle = (sessionID: SessionSchema.ID) =>
    store.messages({ sessionID, type: "idle", order: "desc", limit: 1 }).pipe(
      Effect.map(([message]) => (message?.type === "idle" ? message.id : undefined)),
      Effect.orDie,
    )

  const deliverToParent = Effect.fnUntraced(function* (
    recovery: Recovery,
    idleID: SessionMessage.ID,
    legacyID: SessionMessage.ID | undefined,
    outcome: { status: "completed"; output: string } | { status: "error"; error: string },
  ) {
    let inboxID = noticeID(idleID)
    if (legacyID) {
      const delivered = yield* store.message(legacyID)
      if (delivered) {
        if (delivered.sessionID === recovery.parentSessionID && delivered.message.type === "synthetic") return true
        inboxID = legacyID
      } else if (
        yield* db
          .select({ id: SessionInboxTable.id })
          .from(SessionInboxTable)
          .where(eq(SessionInboxTable.id, legacyID))
          .get()
          .pipe(Effect.orDie)
      ) {
        inboxID = legacyID
      }
    }
    return yield* SubagentCompletion.deliver(sessions, jobs, {
      inboxID,
      recovery,
      ...outcome,
      resume: deferredParents.has(recovery.parentSessionID) ? false : undefined,
    }).pipe(
      Effect.as(true),
      Effect.catchTag("Session.NotFoundError", () => removeMarker(recovery.childSessionID).pipe(Effect.as(false))),
      Effect.orDie,
    )
  })

  // Every unreported busy period of a child, read forward in sequence order from its saved marker.
  // Text results and failures notify the parent; empty successes, interruptions, and busy periods
  // started by a direct user prompt advance the marker silently.
  const syncUnlocked = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
    if ((foreground.get(sessionID) ?? 0) > 0) return
    const marker = yield* readMarker(sessionID)
    if (!marker) return
    const { recovery } = marker
    const child = yield* store.get(sessionID)
    if (!child || child.parentID !== recovery.parentSessionID || !(yield* store.get(recovery.parentSessionID))) {
      yield* removeMarker(sessionID)
      return
    }

    let reported = marker.reported
    let pendingTurn = marker.pending
    let cursor = reported ? { id: reported, direction: "next" as const } : undefined
    let assistant: SessionMessage.Assistant | undefined
    let starter: "subagent" | "direct" | undefined
    while (true) {
      const page = yield* store.messages({ sessionID, order: "asc", limit: TURN_PAGE, cursor }).pipe(Effect.orDie)
      for (const message of page) {
        if (starter === undefined && (message.type === "user" || message.type === "synthetic"))
          starter = message.type === "user" && message.metadata?.source !== "subagent" ? "direct" : "subagent"
        if (message.type === "assistant" && message.time.completed !== undefined && message.error === undefined)
          assistant = message
        if (message.type !== "idle") continue

        const legacyID = pendingTurn ? marker.notification_id : undefined
        const shouldDeliver = (starter !== "direct" || pendingTurn) && message.outcome !== "interrupted"
        pendingTurn = false
        if (shouldDeliver) {
          const output = message.outcome === "succeeded" ? SubagentCompletion.extractText(assistant) : undefined
          const outcome =
            message.outcome === "failed"
              ? { status: "error" as const, error: message.error?.message ?? "Subagent failed" }
              : output !== undefined
                ? { status: "completed" as const, output }
                : undefined
          if (outcome && !(yield* deliverToParent(recovery, message.id, legacyID, outcome))) return
        }
        reported = message.id
        yield* updateMarker(sessionID, reported, true)
        assistant = undefined
        starter = undefined
      }
      const last = page.at(-1)
      if (page.length < TURN_PAGE || !last) {
        if (((yield* latestIdle(sessionID)) ?? null) !== reported) {
          assistant = undefined
          starter = undefined
          cursor = reported ? { id: reported, direction: "next" } : undefined
          continue
        }
        yield* updateMarker(sessionID, reported, false)
        return
      }
      cursor = { id: last.id, direction: "next" }
    }
  })

  const sync = (sessionID: SessionSchema.ID) => locks.withLock(sessionID)(syncUnlocked(sessionID))

  const latestTurnOutput = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
    let seenIdle = false
    let assistant: SessionMessage.Assistant | undefined
    let cursor: { id: SessionMessage.ID; direction: "next" } | undefined
    while (true) {
      const page = yield* store.messages({ sessionID, order: "desc", limit: TURN_PAGE, cursor }).pipe(Effect.orDie)
      for (const message of page) {
        if (message.type === "idle") {
          if (seenIdle) return SubagentCompletion.text(assistant)
          seenIdle = true
          settled.set(sessionID, message.id)
          continue
        }
        if (
          !assistant &&
          message.type === "assistant" &&
          message.time.completed !== undefined &&
          message.error === undefined
        )
          assistant = message
      }
      const last = page.at(-1)
      if (page.length < TURN_PAGE || !last) return SubagentCompletion.text(assistant)
      cursor = { id: last.id, direction: "next" }
    }
  })

  yield* bus
    .subscribe([
      SessionEvent.Execution.Succeeded,
      SessionEvent.Execution.Failed,
      SessionEvent.Execution.Interrupted,
      SessionEvent.Deleted,
    ])
    .pipe(
      Stream.runForEach((event) => {
        const sessionID = event.data.sessionID
        if (event.type === SessionEvent.Deleted.type)
          return locks.withLock(sessionID)(
            Effect.sync(() => {
              foreground.delete(sessionID)
              settled.delete(sessionID)
            }),
          )
        if (event.type === SessionEvent.Execution.Interrupted.type && event.data.reason === "shutdown")
          return Effect.void
        return sync(sessionID).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("subagent.sync_failed", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )

  const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
    const key = `${recovery.childSessionID}:${startedAt}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id: recovery.childSessionID })).info
      if (!info || info.status === "running") return
      if (info.status === "cancelled") {
        yield* sessions.interrupt(recovery.childSessionID)
        yield* SubagentCompletion.deliver(sessions, jobs, { ...info, recovery })
        return
      }
      yield* sync(recovery.childSessionID)
      if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
    }).pipe(
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )
  })

  const start = (recovery: Recovery) =>
    jobs
      .start({
        id: recovery.childSessionID,
        type: "subagent",
        title: recovery.description,
        metadata: {},
        recovery,
        run: Effect.gen(function* () {
          settled.delete(recovery.childSessionID)
          yield* sessions.resume(recovery.childSessionID).pipe(
            Effect.onError(() =>
              latestIdle(recovery.childSessionID).pipe(
                Effect.map((idle) => {
                  if (idle) settled.set(recovery.childSessionID, idle)
                }),
                Effect.ignore,
              ),
            ),
          )
          return yield* latestTurnOutput(recovery.childSessionID)
        }),
      })
      .pipe(Effect.setContext(context))

  const track = Effect.fn("SubagentJob.track")((recovery: Recovery) =>
    locks.withLock(recovery.childSessionID)(
      Effect.gen(function* () {
        const existing = yield* readMarker(recovery.childSessionID)
        if (existing) yield* syncUnlocked(recovery.childSessionID)
        const refreshed = existing ? yield* readMarker(recovery.childSessionID) : undefined
        const reported = refreshed ? refreshed.reported : ((yield* latestIdle(recovery.childSessionID)) ?? null)
        const now = yield* Clock.currentTimeMillis
        const shared = {
          id: recovery.childSessionID,
          session_id: recovery.parentSessionID,
          title: recovery.description,
          recovery,
          reported,
          dirty: true,
          time_updated: now,
        }
        yield* db
          .insert(JobTable)
          .values({
            ...shared,
            notification_id: SessionMessage.ID.create(),
            child_session_id: recovery.childSessionID,
            kind: "subagent",
            status: "completed",
            pending: false,
            time_created: now,
          })
          .onConflictDoUpdate({ target: JobTable.child_session_id, set: shared })
          .run()
          .pipe(Effect.orDie)
      }),
    ),
  )

  const block: Interface["block"] = (recovery, prompt) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const childID = recovery.childSessionID
        let consumeSettled = false
        foreground.set(childID, (foreground.get(childID) ?? 0) + 1)
        return yield* Effect.gen(function* () {
          yield* restore(prompt)
          yield* start(recovery)
          const outcome = yield* restore(
            jobs
              .block({ id: childID, sessionID: recovery.parentSessionID })
              .pipe(
                Effect.onInterrupt(() =>
                  Effect.all([sessions.interrupt(childID), jobs.cancel(childID)], { discard: true }),
                ),
              ),
          )
          if (outcome?.type === "backgrounded") {
            yield* notify(recovery, outcome.info.started_at)
            return outcome
          }
          if (outcome?.info.status === "cancelled") yield* sessions.interrupt(childID)
          consumeSettled = true
          return outcome
        }).pipe(
          Effect.ensuring(
            locks
              .withLock(childID)(
                Effect.gen(function* () {
                  if (consumeSettled) {
                    const marker = yield* readMarker(childID)
                    const idle = settled.get(childID)
                    if (marker && idle && marker.reported !== idle) yield* updateMarker(childID, idle, true)
                  }
                  const remaining = (foreground.get(childID) ?? 1) - 1
                  if (remaining <= 0) {
                    foreground.delete(childID)
                    settled.delete(childID)
                    yield* syncUnlocked(childID)
                  } else {
                    foreground.set(childID, remaining)
                  }
                }),
              )
              .pipe(Effect.orDie),
          ),
        )
      }),
    )

  const recover: Interface["recover"] = (suspended, prepare) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        for (const id of suspended) deferredParents.add(id)
      }),
      () =>
        prepare.pipe(
          Effect.tap(() =>
            db
              .select({ childSessionID: JobTable.child_session_id })
              .from(JobTable)
              .where(eq(JobTable.dirty, true))
              .orderBy(asc(JobTable.time_created), asc(JobTable.notification_id))
              .all()
              .pipe(
                Effect.orDie,
                Effect.flatMap((rows) =>
                  Effect.forEach(rows, (row) => (row.childSessionID ? sync(row.childSessionID) : Effect.void), {
                    discard: true,
                  }),
                ),
              ),
          ),
        ),
      () =>
        Effect.sync(() => {
          for (const id of suspended) deferredParents.delete(id)
        }),
    )

  return Service.of({
    track,
    start,
    block,
    background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
      const info = yield* jobs.background(recovery.childSessionID)
      if (info) yield* notify(recovery, info.started_at)
    }),
    notify,
    sync,
    recover,
  })
})

export const layer = Layer.effect(Service, make)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Session.node, SessionStore.node, Job.node, Bus.node],
})
