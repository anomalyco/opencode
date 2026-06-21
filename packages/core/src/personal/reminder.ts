import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { PersonalRemindersTable } from "./sql"
import { eq, desc, and, lte } from "drizzle-orm"
import { Identifier } from "../util/identifier"

export interface ReminderEntry {
  id: string
  title: string
  description: string | null
  due_at: number | null
  remind_at: number | null
  status: string
  priority: string
  category: string | null
  recurring: string | null
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly list: (status?: string, category?: string) => Effect.Effect<ReminderEntry[]>
  readonly get: (id: string) => Effect.Effect<ReminderEntry | undefined>
  readonly create: (
    title: string,
    description?: string,
    dueAt?: number,
    remindAt?: number,
    priority?: string,
    category?: string,
    recurring?: string,
  ) => Effect.Effect<ReminderEntry>
  readonly update: (
    id: string,
    data: Partial<Omit<ReminderEntry, "id" | "time_created" | "time_updated">>,
  ) => Effect.Effect<ReminderEntry>
  readonly complete: (id: string) => Effect.Effect<void>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly checkAndNotify: () => Effect.Effect<ReminderEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Reminder") {}

function parseReminderRow(row: any): ReminderEntry {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    due_at: row.due_at,
    remind_at: row.remind_at,
    status: row.status ?? "pending",
    priority: row.priority ?? "medium",
    category: row.category,
    recurring: row.recurring,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service
  return Service.of({
    list: (status, category) =>
      Effect.gen(function* () {
        const conditions: any[] = []
        if (status !== undefined) conditions.push(eq(PersonalRemindersTable.status, status))
        if (category !== undefined) conditions.push(eq(PersonalRemindersTable.category, category))
        const where = conditions.length > 0 ? and(...conditions) : undefined
        const query = db
          .select()
          .from(PersonalRemindersTable)
          .orderBy(desc(PersonalRemindersTable.time_created))
        const rows = yield* (where ? query.where(where) : query).all().pipe(Effect.orDie)
        return rows.map(parseReminderRow)
      }),
    get: (id) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalRemindersTable)
          .where(eq(PersonalRemindersTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return rows.length > 0 ? parseReminderRow(rows[0]) : undefined
      }),
    create: (title, description, dueAt, remindAt, priority, category, recurring) =>
      Effect.gen(function* () {
        const id = "rem_" + Identifier.ascending()
        const now = Date.now()
        const row = {
          id,
          title,
          description: description ?? null,
          due_at: dueAt ?? null,
          remind_at: remindAt ?? null,
          status: "pending",
          priority: priority ?? "medium",
          category: category ?? null,
          recurring: recurring ?? null,
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(PersonalRemindersTable).values(row).pipe(Effect.orDie)
        return parseReminderRow(row)
      }),
    update: (id, data) =>
      Effect.gen(function* () {
        const now = Date.now()
        const updates: Record<string, any> = { time_updated: now }
        if (data.title !== undefined) updates.title = data.title
        if (data.description !== undefined) updates.description = data.description
        if (data.due_at !== undefined) updates.due_at = data.due_at
        if (data.remind_at !== undefined) updates.remind_at = data.remind_at
        if (data.status !== undefined) updates.status = data.status
        if (data.priority !== undefined) updates.priority = data.priority
        if (data.category !== undefined) updates.category = data.category
        if (data.recurring !== undefined) updates.recurring = data.recurring
        yield* db
          .update(PersonalRemindersTable)
          .set(updates)
          .where(eq(PersonalRemindersTable.id, id))
          .run()
          .pipe(Effect.orDie)
        const rows = yield* db
          .select()
          .from(PersonalRemindersTable)
          .where(eq(PersonalRemindersTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return parseReminderRow(rows[0])
      }),
    complete: (id) =>
      Effect.gen(function* () {
        const now = Date.now()
        yield* db
          .update(PersonalRemindersTable)
          .set({ status: "completed", time_updated: now })
          .where(eq(PersonalRemindersTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    delete: (id) =>
      Effect.gen(function* () {
        yield* db
          .delete(PersonalRemindersTable)
          .where(eq(PersonalRemindersTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    checkAndNotify: Effect.gen(function* () {
      const now = Date.now()
      const rows = yield* db
        .select()
        .from(PersonalRemindersTable)
        .where(
          and(
            eq(PersonalRemindersTable.status, "pending"),
            lte(PersonalRemindersTable.remind_at, now),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      return rows.map(parseReminderRow)
    }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as Reminder }
