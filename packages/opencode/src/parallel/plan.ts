import { Database, NotFoundError, eq } from "../storage/db"
import { PlanTable } from "./plan.sql"
import { Bus } from "@/bus"
import { ParallelEvent } from "./events"
import { validateTransition, validateWorkerTransition } from "./transitions"
import type { Plan, PlanID, SubtaskID, WorkerState, PlanStatus, WorkerStatus, Subtask, ModelRef } from "./schema"
import { PlanID as PlanIDSchema, SubtaskID as SubtaskIDSchema, Plan as PlanSchema } from "./schema"
import { SessionID } from "@/session/schema"
import { fn } from "@/util/fn"

type PlanRow = typeof PlanTable.$inferSelect

function fromRow(row: PlanRow): Plan {
  return {
    id: row.id,
    sessionID: row.session_id,
    status: row.status,
    task: row.task,
    orchestratorModel: row.orchestrator_model,
    workerModel: row.worker_model,
    subtasks: row.subtasks,
    workers: row.workers,
    time: {
      created: row.time_created,
      approved: row.time_approved ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  }
}

function toRow(plan: Plan) {
  return {
    id: plan.id,
    session_id: plan.sessionID,
    status: plan.status,
    task: plan.task,
    orchestrator_model: plan.orchestratorModel,
    worker_model: plan.workerModel,
    subtasks: plan.subtasks,
    workers: plan.workers,
    time_created: plan.time.created,
    time_approved: plan.time.approved ?? null,
    time_completed: plan.time.completed ?? null,
  }
}

export namespace PlanStore {
  export const create = fn(
    PlanSchema.pick({
      sessionID: true,
      task: true,
      orchestratorModel: true,
      workerModel: true,
    }),
    async (input): Promise<Plan> => {
      const plan: Plan = {
        id: PlanIDSchema.descending(),
        sessionID: input.sessionID,
        status: "draft",
        task: input.task,
        orchestratorModel: input.orchestratorModel,
        workerModel: input.workerModel,
        subtasks: [],
        workers: [],
        time: {
          created: Date.now(),
        },
      }
      Database.use((db) => {
        db.insert(PlanTable).values(toRow(plan)).run()
        Database.effect(() => Bus.publish(ParallelEvent.PlanUpdated, { plan }))
      })
      return plan
    },
  )

  export const get = fn(PlanIDSchema.zod, async (id: PlanID): Promise<Plan> => {
    const row = Database.use((db) => db.select().from(PlanTable).where(eq(PlanTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Plan not found: ${id}` })
    return fromRow(row)
  })

  export async function list(): Promise<Plan[]> {
    const rows = Database.use((db) => db.select().from(PlanTable).orderBy(PlanTable.time_created).all())
    return rows.map(fromRow)
  }

  export const update = fn(
    PlanSchema.pick({ id: true }).extend({
      status: PlanSchema.shape.status.optional(),
      subtasks: PlanSchema.shape.subtasks.optional(),
      workers: PlanSchema.shape.workers.optional(),
    }),
    async (input): Promise<Plan> => {
      const existing = await get(input.id)
      const updates: Partial<PlanRow> = {}

      if (input.status !== undefined) {
        validateTransition(existing.status, input.status)
        updates.status = input.status
        if (input.status === "approved") {
          updates.time_approved = Date.now()
        }
        if (input.status === "done" || input.status === "failed") {
          updates.time_completed = Date.now()
        }
      }
      if (input.subtasks !== undefined) {
        updates.subtasks = input.subtasks as any
      }
      if (input.workers !== undefined) {
        updates.workers = input.workers as any
      }

      return Database.use((db) => {
        const row = db.update(PlanTable).set(updates).where(eq(PlanTable.id, input.id)).returning().get()
        if (!row) throw new NotFoundError({ message: `Plan not found: ${input.id}` })
        const plan = fromRow(row)
        Database.effect(() => Bus.publish(ParallelEvent.PlanUpdated, { plan }))
        return plan
      })
    },
  )

  export const transition = fn(
    PlanSchema.pick({ id: true }).extend({
      status: PlanSchema.shape.status,
    }),
    async (input): Promise<Plan> => {
      return update(input)
    },
  )

  export const updateWorker = fn(
    PlanSchema.pick({ id: true }).extend({
      subtaskID: SubtaskIDSchema.zod,
      status: PlanSchema.shape.workers.element.shape.status.optional(),
      sessionID: SessionID.zod.optional(),
      worktreeName: PlanSchema.shape.workers.element.shape.worktreeName.optional(),
      worktreeDir: PlanSchema.shape.workers.element.shape.worktreeDir.optional(),
      branch: PlanSchema.shape.workers.element.shape.branch.optional(),
      error: PlanSchema.shape.workers.element.shape.error.optional(),
      diffStat: PlanSchema.shape.workers.element.shape.diffStat.optional(),
    }),
    async (input): Promise<Plan> => {
      const plan = await get(input.id)
      const workerIndex = plan.workers.findIndex((w) => w.subtaskID === input.subtaskID)
      if (workerIndex === -1) {
        throw new NotFoundError({ message: `Worker not found: ${input.subtaskID}` })
      }

      const worker = plan.workers[workerIndex]
      if (input.status !== undefined) {
        validateWorkerTransition(worker.status, input.status)
      }

      const updatedWorker: WorkerState = {
        ...worker,
        ...(input.status !== undefined && { status: input.status }),
        ...(input.sessionID !== undefined && { sessionID: input.sessionID }),
        ...(input.worktreeName !== undefined && { worktreeName: input.worktreeName }),
        ...(input.worktreeDir !== undefined && { worktreeDir: input.worktreeDir }),
        ...(input.branch !== undefined && { branch: input.branch }),
        ...(input.error !== undefined && { error: input.error }),
        ...(input.diffStat !== undefined && { diffStat: input.diffStat }),
      }

      const updatedWorkers = [...plan.workers]
      updatedWorkers[workerIndex] = updatedWorker

      return Database.use((db) => {
        const row = db
          .update(PlanTable)
          .set({ workers: updatedWorkers as any })
          .where(eq(PlanTable.id, input.id))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Plan not found: ${input.id}` })
        const plan = fromRow(row)
        Database.effect(() => {
          Bus.publish(ParallelEvent.PlanUpdated, { plan })
          Bus.publish(ParallelEvent.WorkerUpdated, { planID: input.id, worker: updatedWorker })
        })
        return plan
      })
    },
  )

  export const remove = fn(PlanIDSchema.zod, async (id: PlanID): Promise<void> => {
    Database.use((db) => {
      db.delete(PlanTable).where(eq(PlanTable.id, id)).run()
    })
  })
}
