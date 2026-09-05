export * as Automation from "./automation"

import { DateTime, Effect, Layer, Schema, Context } from "effect"
import { and, eq, desc } from "drizzle-orm"
import { Database } from "../database/database"
import { SessionV2 } from "../session"
import { SessionInput } from "../session/input"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionExecution } from "../session/execution"
import { AutomationTriggerTable, AutomationRunTable, type Schedule } from "./sql"
import { AutomationQueue } from "./queue"
import { makeGlobalNode } from "../effect/app-node"

export type { Schedule }

export interface Trigger {
  readonly id: string
  readonly sessionID: SessionSchema.ID
  readonly name: string
  readonly prompt: string
  readonly schedule: Schedule
  readonly enabled: boolean
  readonly agent?: string
  readonly lastFired?: number
  readonly locked: boolean
  readonly lockOwner?: string
  readonly lockExpires?: number
  readonly timeCreated: number
  readonly timeUpdated: number
}

export interface Run {
  readonly id: string
  readonly triggerID: string
  readonly sessionID: SessionSchema.ID
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled"
  readonly prompt: string
  readonly agent?: string
  readonly error?: string
  readonly payload?: unknown
  readonly timeStarted: number
  readonly timeCompleted?: number
  readonly timeCreated: number
  readonly timeUpdated: number
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Automation.NotFoundError", {
  id: Schema.String,
}) {}

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "Automation.SessionNotFoundError",
  { sessionID: SessionSchema.ID },
) {}

export class LockError extends Schema.TaggedErrorClass<LockError>()("Automation.LockError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export class PromptConflictError extends Schema.TaggedErrorClass<PromptConflictError>()(
  "Automation.PromptConflictError",
  { sessionID: SessionSchema.ID, messageID: Schema.String },
) {}

export type Error = NotFoundError | LockError | PromptConflictError

const LOCK_TTL_MS = 5 * 60 * 1000 // 5 minutes

const fromRow = (row: typeof AutomationTriggerTable.$inferSelect): Trigger => ({
  id: row.id,
  sessionID: SessionSchema.ID.make(row.session_id),
  name: row.name,
  prompt: row.prompt,
  schedule: row.schedule,
  enabled: row.enabled,
  ...(row.agent ? { agent: row.agent } : {}),
  ...(row.last_fired ? { lastFired: row.last_fired } : {}),
  locked: row.locked ?? false,
  ...(row.lock_owner ? { lockOwner: row.lock_owner } : {}),
  ...(row.lock_expires ? { lockExpires: row.lock_expires } : {}),
  timeCreated: row.time_created,
  timeUpdated: row.time_updated,
})

const runFromRow = (row: typeof AutomationRunTable.$inferSelect): Run => ({
  id: row.id,
  triggerID: row.trigger_id,
  sessionID: SessionSchema.ID.make(row.session_id),
  status: row.status,
  prompt: row.prompt,
  ...(row.agent ? { agent: row.agent } : {}),
  ...(row.error ? { error: row.error } : {}),
  ...(row.payload ? { payload: row.payload } : {}),
  timeStarted: row.time_started,
  ...(row.time_completed ? { timeCompleted: row.time_completed } : {}),
  timeCreated: row.time_created,
  timeUpdated: row.time_updated,
})

export interface Interface {
  readonly create: (input: {
    id?: string
    sessionID: SessionSchema.ID
    name: string
    prompt: string
    schedule: Schedule
    enabled?: boolean
    agent?: string
  }) => Effect.Effect<Trigger, never>
  readonly get: (id: string) => Effect.Effect<Trigger, NotFoundError>
  readonly list: (input?: { sessionID?: SessionSchema.ID }) => Effect.Effect<Trigger[], never>
  readonly update: (
    id: string,
    patch: Partial<{ name: string; prompt: string; enabled: boolean; agent: string }>,
  ) => Effect.Effect<Trigger, NotFoundError>
  readonly remove: (id: string) => Effect.Effect<boolean, never>
  readonly fire: (id: string, payload?: unknown) => Effect.Effect<Run, NotFoundError | LockError | PromptConflictError>
  readonly getRuns: (input?: { triggerID?: string; sessionID?: SessionSchema.ID; status?: Run["status"]; limit?: number }) => Effect.Effect<Run[], never>
  readonly getRun: (id: string) => Effect.Effect<Run, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Automation") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const session = yield* SessionV2.Service
    const execution = yield* SessionExecution.Service
    const queue = yield* AutomationQueue.Service

    const acquireLock = Effect.fn("Automation.acquireLock")(function* (id: string, owner: string) {
      const now = Date.now()
      const expires = now + LOCK_TTL_MS
      // Try to acquire lock - only succeeds if not locked or lock expired
      yield* db
        .update(AutomationTriggerTable)
        .set({ locked: true, lock_owner: owner, lock_expires: expires, time_updated: now })
        .where(
          and(
            eq(AutomationTriggerTable.id, id),
            eq(AutomationTriggerTable.locked, false),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      // Verify we got the lock
      const existing = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
      if (!existing || existing.lock_owner !== owner) {
        return yield* new LockError({ id, message: "Trigger is locked by another process" })
      }
    })

    const releaseLock = Effect.fn("Automation.releaseLock")(function* (id: string, owner: string) {
      const now = Date.now()
      yield* db
        .update(AutomationTriggerTable)
        .set({ locked: false, lock_owner: null, lock_expires: null, time_updated: now })
        .where(and(eq(AutomationTriggerTable.id, id), eq(AutomationTriggerTable.lock_owner, owner)))
        .pipe(Effect.orDie)
    })

    const createRun = Effect.fn("Automation.createRun")(function* (
      triggerID: string,
      sessionID: SessionSchema.ID,
      prompt: string,
      agent: string | undefined,
      payload?: unknown,
    ) {
      const id = crypto.randomUUID()
      const now = Date.now()
      yield* db
        .insert(AutomationRunTable)
        .values({
          id,
          trigger_id: triggerID,
          session_id: sessionID,
          status: "pending",
          prompt,
          ...(agent ? { agent } : {}),
          ...(payload ? { payload } : {}),
          time_started: now,
          time_created: now,
          time_updated: now,
        })
        .pipe(Effect.orDie)
      return id
    })

    const updateRunStatus = Effect.fn("Automation.updateRunStatus")(function* (
      runID: string,
      status: Run["status"],
      error?: string,
    ) {
      const now = Date.now()
      const updates: Record<string, unknown> = { status, time_updated: now }
      if (status === "running") updates.time_started = now
      if (status === "completed" || status === "failed" || status === "cancelled") {
        updates.time_completed = now
      }
      if (error) updates.error = error
      yield* db.update(AutomationRunTable).set(updates).where(eq(AutomationRunTable.id, runID)).pipe(Effect.orDie)
    })

    const settle = (runID: string | undefined, status: Run["status"], error?: string): Effect.Effect<void, never> => {
      if (!runID) return Effect.void
      return updateRunStatus(runID, status, error).pipe(Effect.orDie)
    }

    // Executes one queued automation job against its Session, then runs the
    // verification gate for eligible (high-complexity) jobs before settling the run.
    const handleJob: AutomationQueue.JobHandler = (job) => {
      const sessionID = SessionSchema.ID.make(job.sessionID)
      const execute = Effect.gen(function* () {
        if (job.agent) {
          yield* session.switchAgent({ sessionID, agent: job.agent }).pipe(Effect.orDie)
        }
        yield* session
          .prompt({
            id: SessionMessage.ID.make(`auto_${job.triggerID}_${job.id}`),
            sessionID,
            prompt: PromptInput.Prompt.make({ text: job.prompt }),
            delivery: "steer",
          })
          .pipe(
            Effect.catchTag("Session.NotFoundError", () =>
              Effect.fail(new NotFoundError({ id: job.triggerID })),
            ),
            Effect.catchTag("Session.PromptConflictError", (e) =>
              Effect.fail(new PromptConflictError({ sessionID, messageID: e.messageID })),
            ),
          )
        yield* execution.resume(sessionID).pipe(Effect.orDie)

        if (queue.willVerify(job)) {
          const outcome = yield* execution.reflect(sessionID).pipe(Effect.orDie)
          const converged = outcome.why.converged && outcome.then.converged
          const message = converged
            ? undefined
            : `Verification did not converge (misalignment ${outcome.diagnostic.totalMisalignment.toFixed(2)})`
          yield* settle(job.runID, converged ? "completed" : "failed", message)
        } else {
          yield* settle(job.runID, "completed")
        }
      }).pipe(
        Effect.catch((error) =>
          settle(job.runID, "failed", error instanceof Error ? error.message : String(error)),
        ),
      )
      return Effect.uninterruptible(execute).pipe(
        Effect.ensuring(
          job.lockOwner
            ? releaseLock(job.triggerID, job.lockOwner).pipe(Effect.orDie)
            : Effect.void,
        ),
      )
    }

    yield* queue.setHandler(handleJob)

    return Service.of({
      create: Effect.fn("Automation.create")(function* (input) {
        const id = input.id ?? crypto.randomUUID()
        const now = Date.now()
        yield* db
          .insert(AutomationTriggerTable)
          .values({
            id,
            session_id: input.sessionID,
            name: input.name,
            prompt: input.prompt,
            schedule: input.schedule,
            enabled: input.enabled ?? true,
            ...(input.agent ? { agent: input.agent } : {}),
            last_fired: null,
            locked: false,
            lock_owner: null,
            lock_expires: null,
            time_created: now,
            time_updated: now,
          })
          .pipe(Effect.orDie)
        const row = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        return fromRow(row!)
      }),

      get: Effect.fn("Automation.get")(function* (id) {
        const row = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ id })
        return fromRow(row)
      }),

      list: Effect.fn("Automation.list")(function* (input) {
        const query = db.select().from(AutomationTriggerTable)
        const rows = yield* (input?.sessionID
          ? query.where(eq(AutomationTriggerTable.session_id, input.sessionID))
          : query
        ).pipe(Effect.orDie)
        return rows.map(fromRow)
      }),

      update: Effect.fn("Automation.update")(function* (id, patch) {
        const existing = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!existing) return yield* new NotFoundError({ id })
        const updates: Record<string, unknown> = { time_updated: Date.now() }
        if (patch.name !== undefined) updates.name = patch.name
        if (patch.prompt !== undefined) updates.prompt = patch.prompt
        if (patch.enabled !== undefined) updates.enabled = patch.enabled
        if (patch.agent !== undefined) updates.agent = patch.agent
        yield* db.update(AutomationTriggerTable).set(updates).where(eq(AutomationTriggerTable.id, id)).pipe(Effect.orDie)
        const row = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        return fromRow(row!)
      }),

      remove: Effect.fn("Automation.remove")(function* (id) {
        const existing = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!existing) return false
        yield* db.delete(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).run().pipe(Effect.orDie)
        return true
      }),

      fire: Effect.fn("Automation.fire")(function* (id, payload?: unknown) {
        const owner = `fire_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        const trigger = yield* db.select().from(AutomationTriggerTable).where(eq(AutomationTriggerTable.id, id)).get().pipe(Effect.orDie)
        if (!trigger) return yield* new NotFoundError({ id })

        if (!trigger.enabled) {
          return yield* new LockError({ id, message: "Trigger is disabled" })
        }

        // Try to acquire lock. It is released by the queue handler once the job settles.
        yield* acquireLock(id, owner)

        // Create the run and enqueue the job, routing through the automation queue.
        // On failure the lock is released here; on success ownership passes to the handler.
        const enqueued = yield* Effect.gen(function* () {
          const runID = yield* createRun(id, SessionSchema.ID.make(trigger.session_id), trigger.prompt, trigger.agent ?? undefined, payload)
          yield* queue.enqueue({
            runID,
            sessionID: trigger.session_id,
            prompt: trigger.prompt,
            triggerID: id,
            deduplicationKey: id,
            // Explicit per-trigger agent override wins over classified routing.
            ...(trigger.agent ? { agent: trigger.agent } : {}),
            lockOwner: owner,
          })
          return runID
        }).pipe(
          Effect.catchTag("AutomationQueue.DeduplicationError", () =>
            Effect.gen(function* () {
              yield* releaseLock(id, owner).pipe(Effect.orDie)
              return yield* new LockError({ id, message: "Trigger already has an active job" })
            }),
          ),
          Effect.catch(() =>
            Effect.gen(function* () {
              yield* releaseLock(id, owner).pipe(Effect.orDie)
              return yield* new LockError({ id, message: "Failed to enqueue job" })
            }),
          ),
        )

        // Queue status is "running"; the handler marks it completed/failed.
        yield* updateRunStatus(enqueued, "running")

        // Update trigger last_fired
        yield* db
          .update(AutomationTriggerTable)
          .set({ last_fired: Date.now(), time_updated: Date.now() })
          .where(eq(AutomationTriggerTable.id, id))
          .pipe(Effect.orDie)

        const runRow = yield* db.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, enqueued)).get().pipe(Effect.orDie)
        return runFromRow(runRow!)
      }),

      getRuns: Effect.fn("Automation.getRuns")(function* (input) {
        const baseQuery = db.select().from(AutomationRunTable)
        const where = buildWhere(input)
        const query = where ? baseQuery.where(where) : baseQuery
        const orderedQuery = query.orderBy(desc(AutomationRunTable.time_started))
        const limitedQuery = input?.limit ? orderedQuery.limit(input.limit) : orderedQuery
        const rows = yield* limitedQuery.all().pipe(Effect.orDie)
        return rows.map(runFromRow)
      }),

      getRun: Effect.fn("Automation.getRun")(function* (id) {
        const row = yield* db.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ id })
        return runFromRow(row)
      }),
    })
  }),
)

function buildWhere(input?: { triggerID?: string; sessionID?: SessionSchema.ID; status?: Run["status"] }): ReturnType<typeof and> | undefined {
  if (!input) return undefined
  const conditions: ReturnType<typeof eq>[] = []
  if (input.triggerID) conditions.push(eq(AutomationRunTable.trigger_id, input.triggerID))
  if (input.sessionID) conditions.push(eq(AutomationRunTable.session_id, input.sessionID))
  if (input.status) conditions.push(eq(AutomationRunTable.status, input.status))
  return conditions.length > 0 ? and(...conditions) : undefined
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, SessionV2.node, SessionExecution.node, AutomationQueue.node] })