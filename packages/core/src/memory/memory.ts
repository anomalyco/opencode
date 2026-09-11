export * as Memory from "./memory"

import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Global } from "../global"
import { Identifier } from "../id/id"
import { makeGlobalNode } from "../effect/app-node"

export const Item = Schema.Struct({
  id: Schema.String,
  project_id: Schema.NullOr(Schema.String),
  title: Schema.String,
  content: Schema.String,
  category: Schema.String,
  tags: Schema.Array(Schema.String),
  source: Schema.String,
  session_id: Schema.NullOr(Schema.String),
  time_created: Schema.Number,
  time_updated: Schema.Number,
})
export type Item = Schema.Schema.Type<typeof Item>

export interface TeachInput {
  title?: string
  content: string
  category?: string
  tags?: readonly string[] | string[]
  source?: string
  projectID?: string | null
  sessionID?: string | null
}

export interface RecallInput {
  query: string
  category?: string
  projectID?: string | null
  limit?: number
}

export interface ListInput {
  category?: string
  projectID?: string | null
  limit?: number
  offset?: number
}

export interface LearnInput {
  memories: Array<{
    title?: string
    content: string
    category?: string
    tags?: readonly string[] | string[]
  }>
  projectID?: string | null
  sessionID?: string | null
}

export interface Interface {
  readonly dbPath: string
  readonly teach: (input: TeachInput) => Effect.Effect<Item>
  readonly recall: (input: RecallInput) => Effect.Effect<Item[]>
  readonly list: (input?: ListInput) => Effect.Effect<Item[]>
  readonly get: (id: string) => Effect.Effect<Item | undefined>
  readonly remove: (id: string) => Effect.Effect<boolean>
  readonly learn: (input: LearnInput) => Effect.Effect<Item[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

function rowToItem(row: any): Item {
  let tags: string[] = []
  if (typeof row.tags === "string") {
    try {
      tags = JSON.parse(row.tags)
    } catch {
      tags = []
    }
  } else if (Array.isArray(row.tags)) {
    tags = row.tags
  }

  return {
    id: String(row.id),
    project_id: row.project_id ? String(row.project_id) : null,
    title: String(row.title),
    content: String(row.content),
    category: String(row.category || "general"),
    tags,
    source: String(row.source || "teach"),
    session_id: row.session_id ? String(row.session_id) : null,
    time_created: Number(row.time_created),
    time_updated: Number(row.time_updated),
  }
}

function deriveTitle(content: string, givenTitle?: string): string {
  if (givenTitle && givenTitle.trim()) return givenTitle.trim()
  const firstLine = content.trim().split("\n")[0].trim()
  if (firstLine.length <= 60) return firstLine
  return firstLine.slice(0, 57) + "..."
}

export function initDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA user_version = 1")

  db.run(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'teach',
      session_id TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memory_time_created ON memory(time_created);`)

  // Full text search
  // SQLite maintains an implicit 64-bit rowid for standard tables without WITHOUT ROWID.
  // We map the external content table memory_fts to this rowid for full-text indexing
  // while keeping the public identifier (mem_...) as a descending text primary key.
  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        title,
        content,
        tags,
        content='memory',
        content_rowid='rowid'
      );
    `)
    db.run(`
      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
        INSERT INTO memory_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
      END;
    `)
    db.run(`
      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
      END;
    `)
    db.run(`
      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
        INSERT INTO memory_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
      END;
    `)
  } catch (error) {
    console.warn("Memory: FTS5 full-text search initialization failed; falling back to LIKE search.", error)
  }

  return db
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const dbPath = path.join(Global.Path.data, "memory.db")
    const db = initDatabase(dbPath)

    const hasFtsTable = Boolean(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'").get(),
    )
    let hasBm25 = false
    if (hasFtsTable) {
      try {
        db.prepare("SELECT bm25(memory_fts) FROM memory_fts WHERE memory_fts MATCH ?").all("test")
        hasBm25 = true
      } catch {
        hasBm25 = false
      }
    }

    const teach = Effect.fn("Memory.teach")(function* (input: TeachInput) {
      const now = Date.now()
      const id = Identifier.create("mem", "descending")
      const title = deriveTitle(input.content, input.title)
      const category = input.category?.trim() || "general"
      const tags = JSON.stringify(input.tags || [])
      const source = input.source || "teach"
      const projectID = input.projectID || null
      const sessionID = input.sessionID || null

      const stmt = db.prepare(`
        INSERT INTO memory (id, project_id, title, content, category, tags, source, session_id, time_created, time_updated)
        VALUES ($id, $project_id, $title, $content, $category, $tags, $source, $session_id, $time_created, $time_updated)
      `)
      stmt.run({
        $id: id,
        $project_id: projectID,
        $title: title,
        $content: input.content,
        $category: category,
        $tags: tags,
        $source: source,
        $session_id: sessionID,
        $time_created: now,
        $time_updated: now,
      })

      return {
        id,
        project_id: projectID,
        title,
        content: input.content,
        category,
        tags: input.tags || [],
        source,
        session_id: sessionID,
        time_created: now,
        time_updated: now,
      } satisfies Item
    })

    const recall = Effect.fn("Memory.recall")(function* (input: RecallInput) {
      const limit = input.limit ?? 10
      const query = input.query.trim()
      if (!query) {
        return yield* list({ category: input.category, projectID: input.projectID, limit })
      }

      // Try FTS5 first if available
      if (hasFtsTable) {
        try {
          const sanitized = query.replace(/["'*]/g, "").trim()
          if (sanitized) {
            const ftsQuery = `"${sanitized.replace(/"/g, '""')}"*`
            let sql = `
              SELECT m.* FROM memory m
              JOIN memory_fts f ON m.rowid = f.rowid
              WHERE memory_fts MATCH $match
            `
            const params: Record<string, any> = { $match: ftsQuery }

            if (input.category) {
              sql += ` AND m.category = $category`
              params.$category = input.category
            }
            if (input.projectID) {
              sql += ` AND (m.project_id = $project_id OR m.project_id IS NULL)`
              params.$project_id = input.projectID
            }

            sql += hasBm25
              ? ` ORDER BY bm25(memory_fts), m.time_created DESC LIMIT $limit`
              : ` ORDER BY m.time_created DESC LIMIT $limit`
            params.$limit = limit

            const rows = db.prepare(sql).all(params) as any[]
            if (rows.length > 0) {
              return rows.map(rowToItem)
            }
          }
        } catch {
          // Fall back to LIKE search if FTS query syntax error
        }
      }

      // Fallback: LIKE search across title, content, tags
      let likeSql = `
        SELECT * FROM memory
        WHERE (title LIKE $query OR content LIKE $query OR tags LIKE $query)
      `
      const likeParams: Record<string, any> = { $query: `%${query}%` }

      if (input.category) {
        likeSql += ` AND category = $category`
        likeParams.$category = input.category
      }
      if (input.projectID) {
        likeSql += ` AND (project_id = $project_id OR project_id IS NULL)`
        likeParams.$project_id = input.projectID
      }

      likeSql += ` ORDER BY time_created DESC LIMIT $limit`
      likeParams.$limit = limit

      const rows = db.prepare(likeSql).all(likeParams) as any[]
      return rows.map(rowToItem)
    })

    const list = Effect.fn("Memory.list")(function* (input?: ListInput) {
      const limit = input?.limit ?? 50
      const offset = input?.offset ?? 0

      let sql = `SELECT * FROM memory WHERE 1=1`
      const params: Record<string, any> = { $limit: limit, $offset: offset }

      if (input?.category) {
        sql += ` AND category = $category`
        params.$category = input.category
      }
      if (input?.projectID) {
        sql += ` AND (project_id = $project_id OR project_id IS NULL)`
        params.$project_id = input.projectID
      }

      sql += ` ORDER BY time_created DESC LIMIT $limit OFFSET $offset`
      const rows = db.prepare(sql).all(params) as any[]
      return rows.map(rowToItem)
    })

    const get = Effect.fn("Memory.get")(function* (id: string) {
      const row = db.prepare(`SELECT * FROM memory WHERE id = $id`).get({ $id: id })
      if (!row) return undefined
      return rowToItem(row)
    })

    const remove = Effect.fn("Memory.remove")(function* (id: string) {
      const info = db.prepare(`DELETE FROM memory WHERE id = $id`).run({ $id: id })
      return info.changes > 0
    })

    const learn = Effect.fn("Memory.learn")(function* (input: LearnInput) {
      const results: Item[] = []
      for (const m of input.memories) {
        const item = yield* teach({
          title: m.title,
          content: m.content,
          category: m.category || "learned",
          tags: m.tags || ["learned"],
          source: "learn",
          projectID: input.projectID,
          sessionID: input.sessionID,
        })
        results.push(item)
      }
      return results
    })

    return Service.of({
      dbPath,
      teach,
      recall,
      list,
      get,
      remove,
      learn,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Global.node],
})
