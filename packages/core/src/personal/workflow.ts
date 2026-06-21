import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { PersonalWorkflowsTable } from "./sql"
import { eq, desc } from "drizzle-orm"
import { Identifier } from "../util/identifier"

export interface WorkflowStep {
  action: string
  tool: string
  params: Record<string, any>
  dependsOn?: string[]
}

export interface WorkflowEntry {
  id: string
  name: string
  description: string | null
  steps: WorkflowStep[]
  trigger: any
  active: number
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly create: (name: string, description: string, steps: WorkflowStep[], trigger?: any) => Effect.Effect<WorkflowEntry>
  readonly list: () => Effect.Effect<WorkflowEntry[]>
  readonly get: (id: string) => Effect.Effect<WorkflowEntry | undefined>
  readonly update: (id: string, data: Partial<Pick<WorkflowEntry, "name" | "description" | "steps" | "trigger" | "active">>) => Effect.Effect<WorkflowEntry>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly execute: (id: string) => Effect.Effect<void>
  readonly checkTriggers: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Workflow") {}

function parseWorkflowRow(row: any): WorkflowEntry {
  let steps: WorkflowStep[] = []
  try {
    steps = row.steps ? JSON.parse(row.steps) : []
  } catch {}
  let trigger: any = null
  try {
    trigger = row.trigger ? JSON.parse(row.trigger) : null
  } catch {}
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps,
    trigger,
    active: row.active ?? 0,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service

  const list = Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(PersonalWorkflowsTable)
      .orderBy(desc(PersonalWorkflowsTable.time_created))
      .all()
      .pipe(Effect.orDie)
    return rows.map(parseWorkflowRow)
  })

  const get = (id: string) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(PersonalWorkflowsTable)
        .where(eq(PersonalWorkflowsTable.id, id))
        .all()
        .pipe(Effect.orDie)
      return rows.length > 0 ? parseWorkflowRow(rows[0]) : undefined
    })

  return Service.of({
    create: (name, description, steps, trigger) =>
      Effect.gen(function* () {
        const id = "wf_" + Identifier.ascending()
        const now = Date.now()
        const row = {
          id,
          name,
          description: description ?? null,
          steps: JSON.stringify(steps),
          trigger: trigger ? JSON.stringify(trigger) : null,
          active: 1,
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(PersonalWorkflowsTable).values(row).pipe(Effect.orDie)
        return {
          id,
          name,
          description: description ?? null,
          steps,
          trigger: trigger ?? null,
          active: 1,
          time_created: now,
          time_updated: now,
        }
      }),
    list,
    get,
    update: (id, data) =>
      Effect.gen(function* () {
        const now = Date.now()
        const updates: Record<string, any> = { time_updated: now }
        if (data.name !== undefined) updates.name = data.name
        if (data.description !== undefined) updates.description = data.description
        if (data.steps !== undefined) updates.steps = JSON.stringify(data.steps)
        if (data.trigger !== undefined) updates.trigger = JSON.stringify(data.trigger)
        if (data.active !== undefined) updates.active = data.active
        yield* db
          .update(PersonalWorkflowsTable)
          .set(updates)
          .where(eq(PersonalWorkflowsTable.id, id))
          .run()
          .pipe(Effect.orDie)
        const rows = yield* db
          .select()
          .from(PersonalWorkflowsTable)
          .where(eq(PersonalWorkflowsTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return parseWorkflowRow(rows[0])
      }),
    delete: (id) =>
      Effect.gen(function* () {
        yield* db
          .delete(PersonalWorkflowsTable)
          .where(eq(PersonalWorkflowsTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    execute: (id) =>
      Effect.gen(function* () {
        const wf = yield* get(id)
        if (!wf) return
        yield* Effect.log(`Executing workflow: ${wf.name}`)
        for (const step of wf.steps) {
          yield* Effect.log(`  Step: ${step.action} with tool: ${step.tool}`)
          yield* Effect.sleep(100)
        }
      }),
    checkTriggers: Effect.gen(function* () {
      const workflows = yield* list
      for (const wf of workflows) {
        if (!wf.active) continue
        if (wf.trigger) {
          yield* Effect.log(`Checking trigger for workflow: ${wf.name}`)
        }
      }
    }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as Workflow }
