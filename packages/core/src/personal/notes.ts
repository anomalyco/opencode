import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { PersonalNotesTable } from "./sql"
import { eq, desc, and, like, or } from "drizzle-orm"
import { Identifier } from "../util/identifier"

export interface NoteEntry {
  id: string
  title: string
  content: string
  tags: string[]
  folder: string | null
  pinned: number
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly list: (folder?: string, tag?: string) => Effect.Effect<NoteEntry[]>
  readonly get: (id: string) => Effect.Effect<NoteEntry | undefined>
  readonly create: (title: string, content: string, tags?: string[], folder?: string) => Effect.Effect<NoteEntry>
  readonly update: (id: string, data: Partial<Pick<NoteEntry, "title" | "content" | "tags" | "folder" | "pinned">>) => Effect.Effect<NoteEntry>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly search: (query: string) => Effect.Effect<NoteEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Notes") {}

function parseNoteRow(row: any): NoteEntry {
  let tags: string[] = []
  try {
    tags = row.tags ? JSON.parse(row.tags) : []
  } catch {}
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags,
    folder: row.folder,
    pinned: row.pinned ?? 0,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service
  return Service.of({
    list: (folder, tag) =>
      Effect.gen(function* () {
        const conditions: any[] = []
        if (folder !== undefined) conditions.push(eq(PersonalNotesTable.folder, folder))
        if (tag !== undefined) conditions.push(like(PersonalNotesTable.tags, `%"${tag}"%`))
        const where = conditions.length > 0 ? and(...conditions) : undefined
        const query = db.select().from(PersonalNotesTable).orderBy(desc(PersonalNotesTable.time_created))
        const rows = yield* (where ? query.where(where) : query).all().pipe(Effect.orDie)
        return rows.map(parseNoteRow)
      }),
    get: (id) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalNotesTable)
          .where(eq(PersonalNotesTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return rows.length > 0 ? parseNoteRow(rows[0]) : undefined
      }),
    create: (title, content, tags, folder) =>
      Effect.gen(function* () {
        const id = "note_" + Identifier.ascending()
        const now = Date.now()
        const row = {
          id,
          title,
          content,
          tags: tags ? JSON.stringify(tags) : null,
          folder: folder ?? null,
          pinned: 0,
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(PersonalNotesTable).values(row).pipe(Effect.orDie)
        return parseNoteRow({ ...row, tags: tags ?? [] })
      }),
    update: (id, data) =>
      Effect.gen(function* () {
        const now = Date.now()
        const updates: Record<string, any> = { time_updated: now }
        if (data.title !== undefined) updates.title = data.title
        if (data.content !== undefined) updates.content = data.content
        if (data.tags !== undefined) updates.tags = JSON.stringify(data.tags)
        if (data.folder !== undefined) updates.folder = data.folder
        if (data.pinned !== undefined) updates.pinned = data.pinned
        yield* db
          .update(PersonalNotesTable)
          .set(updates)
          .where(eq(PersonalNotesTable.id, id))
          .run()
          .pipe(Effect.orDie)
        const rows = yield* db
          .select()
          .from(PersonalNotesTable)
          .where(eq(PersonalNotesTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return parseNoteRow(rows[0])
      }),
    delete: (id) =>
      Effect.gen(function* () {
        yield* db
          .delete(PersonalNotesTable)
          .where(eq(PersonalNotesTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    search: (query) =>
      Effect.gen(function* () {
        const pattern = `%${query}%`
        const rows = yield* db
          .select()
          .from(PersonalNotesTable)
          .where(
            or(like(PersonalNotesTable.title, pattern), like(PersonalNotesTable.content, pattern)),
          )
          .orderBy(desc(PersonalNotesTable.time_created))
          .all()
          .pipe(Effect.orDie)
        return rows.map(parseNoteRow)
      }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as Notes }
