export * as TeamJules from "./teamjules"

import { asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { TeamJulesTaskTable, TeamJulesWorkerTable } from "./teamjules/sql"

export const TaskID = Schema.String.pipe(Schema.brand("TeamJules.TaskID"))
export type TaskID = typeof TaskID.Type

export const WorkerID = Schema.String.pipe(Schema.brand("TeamJules.WorkerID"))
export type WorkerID = typeof WorkerID.Type

export const TaskType = Schema.Literals(["issue", "pr", "manual"])
export type TaskType = typeof TaskType.Type

export const TaskStatus = Schema.Literals([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
])
export type TaskStatus = typeof TaskStatus.Type

export const TaskResult = Schema.Struct({
  pr_url: Schema.optional(Schema.String),
  commit_sha: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})
export type TaskResult = typeof TaskResult.Type

export class TaskInfo extends Schema.Class<TaskInfo>("TeamJules.TaskInfo")({
  id: TaskID,
  type: TaskType,
  status: TaskStatus,
  repo: Schema.String,
  branch: Schema.String,
  prompt: Schema.String,
  result: Schema.optional(TaskResult),
  session_id: Schema.optional(Schema.String),
  worker_id: Schema.optional(Schema.String),
  attempt_count: Schema.Number,
  max_attempts: Schema.Number,
  time_created: Schema.Number,
  time_updated: Schema.Number,
  started_at: Schema.optional(Schema.Number),
  completed_at: Schema.optional(Schema.Number),
}) {}

export class WorkerInfo extends Schema.Class<WorkerInfo>("TeamJules.WorkerInfo")({
  id: WorkerID,
  status: Schema.Literals(["idle", "busy", "offline"]),
  last_heartbeat: Schema.Number,
  time_created: Schema.Number,
  time_updated: Schema.Number,
}) {}

export interface Interface {
  readonly createTask: (input: {
    readonly type: TaskType
    readonly repo: string
    readonly branch: string
    readonly prompt: string
  }) => Effect.Effect<TaskInfo>

  readonly getTask: (id: TaskID) => Effect.Effect<TaskInfo | undefined>

  readonly listTasks: (filters?: {
    readonly status?: TaskStatus
    readonly repo?: string
    readonly limit?: number
  }) => Effect.Effect<TaskInfo[]>

  readonly cancelTask: (id: TaskID) => Effect.Effect<void>

  readonly retryTask: (id: TaskID) => Effect.Effect<void>

  readonly claimTask: (workerId: WorkerID) => Effect.Effect<TaskInfo | undefined>

  readonly completeTask: (
    id: TaskID,
    result: TaskResult
  ) => Effect.Effect<void>

  readonly failTask: (id: TaskID, error: string) => Effect.Effect<void>

  readonly heartbeat: (workerId: WorkerID) => Effect.Effect<void>

  readonly registerWorker: () => Effect.Effect<WorkerInfo>

  readonly deregisterWorker: (id: WorkerID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()(
  "@opencode/v2/TeamJules"
) {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const toTaskInfo = (row: typeof TeamJulesTaskTable.$inferSelect): TaskInfo => {
      return new TaskInfo({
        id: row.id as TaskID,
        type: row.type as TaskType,
        status: row.status as TaskStatus,
        repo: row.repo,
        branch: row.branch,
        prompt: row.prompt,
        result: row.result as TaskResult | undefined,
        session_id: row.session_id ?? undefined,
        worker_id: row.worker_id ?? undefined,
        attempt_count: row.attempt_count,
        max_attempts: row.max_attempts,
        time_created: row.time_created,
        time_updated: row.time_updated,
        started_at: undefined,
        completed_at: undefined,
      })
    }

    return Service.of({
      createTask: Effect.fn("TeamJules.createTask")(function* (input) {
        const id = TaskID.make("tj_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
        const now = Date.now()

        yield* db
          .insert(TeamJulesTaskTable)
          .values({
            id,
            type: input.type,
            status: "pending",
            repo: input.repo,
            branch: input.branch,
            prompt: input.prompt,
            attempt_count: 0,
            max_attempts: 3,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)

        const row = yield* db
          .select()
          .from(TeamJulesTaskTable)
          .where(eq(TeamJulesTaskTable.id, id))
          .get()
          .pipe(Effect.orDie)

        return toTaskInfo(row!)
      }),

      getTask: Effect.fn("TeamJules.getTask")(function* (id) {
        const row = yield* db
          .select()
          .from(TeamJulesTaskTable)
          .where(eq(TeamJulesTaskTable.id, id))
          .get()
          .pipe(Effect.orDie)

        return row ? toTaskInfo(row) : undefined
      }),

      listTasks: Effect.fn("TeamJules.listTasks")(function* (filters) {
        const conditions = []
        if (filters?.status) {
          conditions.push(eq(TeamJulesTaskTable.status, filters.status))
        }
        if (filters?.repo) {
          conditions.push(eq(TeamJulesTaskTable.repo, filters.repo))
        }

        const query = db
          .select()
          .from(TeamJulesTaskTable)
          .orderBy(asc(TeamJulesTaskTable.time_created))

        if (conditions.length > 0) {
          query.where(sql`${conditions[0]}`)
        }

        const rows = yield* query.all().pipe(Effect.orDie)
        const limit = filters?.limit ?? 100
        return rows.slice(0, limit).map(toTaskInfo)
      }),

      cancelTask: Effect.fn("TeamJules.cancelTask")(function* (id) {
        yield* db
          .update(TeamJulesTaskTable)
          .set({ status: "cancelled", time_updated: Date.now() })
          .where(eq(TeamJulesTaskTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),

      retryTask: Effect.fn("TeamJules.retryTask")(function* (id) {
        yield* db
          .update(TeamJulesTaskTable)
          .set({
            status: "pending",
            attempt_count: 0,
            worker_id: null,
            result: null,
            time_updated: Date.now(),
          })
          .where(eq(TeamJulesTaskTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),

      claimTask: Effect.fn("TeamJules.claimTask")(function* (workerId) {
        const now = Date.now()
        const leaseMs = 30_000

        // Atomic claim: find a pending task and mark it running
        const claimed = yield* db
          .update(TeamJulesTaskTable)
          .set({
            status: "running",
            worker_id: workerId,
            attempt_count: sql`${TeamJulesTaskTable.attempt_count} + 1`,
            time_updated: now,
          })
          .where(
            sql`${TeamJulesTaskTable.id} IN (
              SELECT id FROM teamjules_task
              WHERE (status = 'pending' OR (status = 'failed' AND attempt_count < max_attempts))
              ORDER BY time_created ASC
              LIMIT 1
            )`
          )
          .returning()
          .get()
          .pipe(Effect.orDie)

        return claimed ? toTaskInfo(claimed) : undefined
      }),

      completeTask: Effect.fn("TeamJules.completeTask")(function* (id, result) {
        yield* db
          .update(TeamJulesTaskTable)
          .set({
            status: "completed",
            result,
            worker_id: null,
            time_updated: Date.now(),
          })
          .where(eq(TeamJulesTaskTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),

      failTask: Effect.fn("TeamJules.failTask")(function* (id, error) {
        const now = Date.now()
        const task = yield* db
          .select()
          .from(TeamJulesTaskTable)
          .where(eq(TeamJulesTaskTable.id, id))
          .get()
          .pipe(Effect.orDie)

        if (!task) return

        const newStatus =
          task.attempt_count >= task.max_attempts ? "failed" : "pending"

        yield* db
          .update(TeamJulesTaskTable)
          .set({
            status: newStatus,
            result: { error },
            worker_id: null,
            time_updated: now,
          })
          .where(eq(TeamJulesTaskTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),

      heartbeat: Effect.fn("TeamJules.heartbeat")(function* (workerId) {
        yield* db
          .update(TeamJulesWorkerTable)
          .set({ last_heartbeat: Date.now(), time_updated: Date.now() })
          .where(eq(TeamJulesWorkerTable.id, workerId))
          .run()
          .pipe(Effect.orDie)
      }),

      registerWorker: Effect.fn("TeamJules.registerWorker")(function* () {
        const id = WorkerID.make("w_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
        const now = Date.now()

        yield* db
          .insert(TeamJulesWorkerTable)
          .values({
            id,
            status: "idle",
            last_heartbeat: now,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)

        return new WorkerInfo({
          id,
          status: "idle",
          last_heartbeat: now,
          time_created: now,
          time_updated: now,
        })
      }),

      deregisterWorker: Effect.fn("TeamJules.deregisterWorker")(function* (id) {
        yield* db
          .delete(TeamJulesWorkerTable)
          .where(eq(TeamJulesWorkerTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    })
  })
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})
