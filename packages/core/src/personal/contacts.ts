import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { PersonalContactsTable } from "./sql"
import { eq } from "drizzle-orm"
import { Identifier } from "../util/identifier"

export interface ContactEntry {
  id: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly list: () => Effect.Effect<ContactEntry[]>
  readonly get: (id: string) => Effect.Effect<ContactEntry | undefined>
  readonly create: (data: { name: string; email?: string; phone?: string; notes?: string }) => Effect.Effect<ContactEntry>
  readonly update: (id: string, data: Partial<Pick<ContactEntry, "name" | "email" | "phone" | "notes">>) => Effect.Effect<ContactEntry>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly search: (query: string) => Effect.Effect<ContactEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Contacts") {}

function parseRow(row: any): ContactEntry {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    notes: row.notes ?? null,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service

  return Service.of({
    list: Effect.gen(function* () {
      const rows = yield* db.select().from(PersonalContactsTable).all().pipe(Effect.orDie)
      return rows.map(parseRow)
    }),

    get: (id: string) =>
      Effect.gen(function* () {
        const rows = yield* db.select().from(PersonalContactsTable).where(eq(PersonalContactsTable.id, id)).all().pipe(Effect.orDie)
        return rows.length > 0 ? parseRow(rows[0]) : undefined
      }),

    create: (data) =>
      Effect.gen(function* () {
        const now = Date.now()
        const id = yield* Identifier.generate("contact")
        yield* db
          .insert(PersonalContactsTable)
          .values({
            id,
            name: data.name,
            email: data.email ?? null,
            phone: data.phone ?? null,
            notes: data.notes ?? null,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        return parseRow({ id, ...data, time_created: now, time_updated: now })
      }),

    update: (id, data) =>
      Effect.gen(function* () {
        const now = Date.now()
        const updates: Record<string, unknown> = { time_updated: now }
        if (data.name !== undefined) updates.name = data.name
        if (data.email !== undefined) updates.email = data.email
        if (data.phone !== undefined) updates.phone = data.phone
        if (data.notes !== undefined) updates.notes = data.notes
        yield* db
          .update(PersonalContactsTable)
          .set(updates)
          .where(eq(PersonalContactsTable.id, id))
          .run()
          .pipe(Effect.orDie)
        return yield* db.select().from(PersonalContactsTable).where(eq(PersonalContactsTable.id, id)).all().pipe(
          Effect.orDie,
          Effect.map((rows) => parseRow(rows[0])),
        )
      }),

    delete: (id) =>
      db.delete(PersonalContactsTable).where(eq(PersonalContactsTable.id, id)).run().pipe(Effect.orDie),

    search: (query) =>
      Effect.gen(function* () {
        const pattern = `%${query}%`
        const all = yield* db.select().from(PersonalContactsTable).all().pipe(Effect.orDie)
        const q = query.toLowerCase()
        return all.filter((r) =>
          r.name.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q),
        ).map(parseRow)
      }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as Contacts }
