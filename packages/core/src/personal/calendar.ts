import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { PersonalEventsTable } from "./sql"
import { eq, desc, and, gte, lte } from "drizzle-orm"
import { Identifier } from "../util/identifier"

export interface EventEntry {
  id: string
  title: string
  description: string | null
  location: string | null
  start_at: number
  end_at: number | null
  all_day: number
  recurring: string | null
  source: string | null
  source_id: string | null
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly list: (startAt?: number, endAt?: number) => Effect.Effect<EventEntry[]>
  readonly get: (id: string) => Effect.Effect<EventEntry | undefined>
  readonly create: (
    title: string,
    startAt: number,
    endAt?: number,
    description?: string,
    location?: string,
    allDay?: number,
  ) => Effect.Effect<EventEntry>
  readonly update: (
    id: string,
    data: Partial<Omit<EventEntry, "id" | "time_created" | "time_updated">>,
  ) => Effect.Effect<EventEntry>
  readonly delete: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Calendar") {}

function parseEventRow(row: any): EventEntry {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    start_at: row.start_at,
    end_at: row.end_at,
    all_day: row.all_day ?? 0,
    recurring: row.recurring,
    source: row.source,
    source_id: row.source_id,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service
  return Service.of({
    list: (startAt, endAt) =>
      Effect.gen(function* () {
        const conditions: any[] = []
        if (startAt !== undefined)
          conditions.push(
            gte(PersonalEventsTable.end_at ?? PersonalEventsTable.start_at, startAt),
          )
        if (endAt !== undefined) conditions.push(lte(PersonalEventsTable.start_at, endAt))
        const where = conditions.length > 0 ? and(...conditions) : undefined
        const query = db
          .select()
          .from(PersonalEventsTable)
          .orderBy(desc(PersonalEventsTable.start_at))
        const rows = yield* (where ? query.where(where) : query).all().pipe(Effect.orDie)
        return rows.map(parseEventRow)
      }),
    get: (id) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalEventsTable)
          .where(eq(PersonalEventsTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return rows.length > 0 ? parseEventRow(rows[0]) : undefined
      }),
    create: (title, startAt, endAt, description, location, allDay) =>
      Effect.gen(function* () {
        const id = "evt_" + Identifier.ascending()
        const now = Date.now()
        const row = {
          id,
          title,
          start_at: startAt,
          end_at: endAt ?? null,
          description: description ?? null,
          location: location ?? null,
          all_day: allDay ?? 0,
          recurring: null,
          source: "local",
          source_id: null,
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(PersonalEventsTable).values(row).pipe(Effect.orDie)
        return parseEventRow(row)
      }),
    update: (id, data) =>
      Effect.gen(function* () {
        const now = Date.now()
        const updates: Record<string, any> = { time_updated: now }
        if (data.title !== undefined) updates.title = data.title
        if (data.description !== undefined) updates.description = data.description
        if (data.location !== undefined) updates.location = data.location
        if (data.start_at !== undefined) updates.start_at = data.start_at
        if (data.end_at !== undefined) updates.end_at = data.end_at
        if (data.all_day !== undefined) updates.all_day = data.all_day
        if (data.recurring !== undefined) updates.recurring = data.recurring
        if (data.source !== undefined) updates.source = data.source
        if (data.source_id !== undefined) updates.source_id = data.source_id
        yield* db
          .update(PersonalEventsTable)
          .set(updates)
          .where(eq(PersonalEventsTable.id, id))
          .run()
          .pipe(Effect.orDie)
        const rows = yield* db
          .select()
          .from(PersonalEventsTable)
          .where(eq(PersonalEventsTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return parseEventRow(rows[0])
      }),
    delete: (id) =>
      Effect.gen(function* () {
        yield* db
          .delete(PersonalEventsTable)
          .where(eq(PersonalEventsTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as Calendar }
