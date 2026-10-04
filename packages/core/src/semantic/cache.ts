export * as SemanticCache from "./cache"

import { Context, Effect, Layer, Schema } from "effect"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"
import { makeGlobalNode } from "../effect/app-node"

export class CacheError extends Schema.TaggedErrorClass<CacheError>()("SemanticCache.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface CacheEntry {
  readonly hash: string
  readonly vector: readonly number[]
}

export interface Interface {
  readonly get: (hash: string, model: string) => Effect.Effect<readonly number[] | undefined, CacheError>
  readonly getBatch: (hashes: readonly string[], model: string) => Effect.Effect<Map<string, readonly number[]>, CacheError>
  readonly set: (hash: string, model: string, vector: readonly number[]) => Effect.Effect<void, CacheError>
  readonly setBatch: (entries: readonly CacheEntry[], model: string) => Effect.Effect<void, CacheError>
  readonly count: (model?: string) => Effect.Effect<number, CacheError>
  readonly hashText: (text: string) => string
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SemanticCache") {}

export const hashText = (text: string): string =>
  createHash("sha256").update(text).digest("hex")

const serializeVector = (vector: readonly number[]): Uint8Array => {
  const f32 = new Float32Array(vector)
  return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
}

const deserializeVector = (blob: Uint8Array): number[] => {
  const f32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
  return Array.from(f32)
}

export const createDatabase = (dbPath?: string): Database => {
  const resolvedPath = dbPath ?? process.env.OPENCODE_EMBED_CACHE_DB ?? path.join(os.homedir(), ".cache", "opencode", "embeddings.sqlite")
  if (resolvedPath !== ":memory:") {
    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  const db = new Database(resolvedPath, { create: true })
  db.run("PRAGMA journal_mode = WAL;")
  db.run("PRAGMA synchronous = NORMAL;")
  db.run(`
    CREATE TABLE IF NOT EXISTS embedding_cache (
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      vector BLOB NOT NULL,
      dims INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (hash, model)
    );
  `)
  return db
}

export const makeService = (db: Database): Interface => {
  const selectOne = db.query<
    { vector: Uint8Array },
    [string, string]
  >("SELECT vector FROM embedding_cache WHERE hash = ? AND model = ?")

  const insertOne = db.prepare(
    "INSERT OR REPLACE INTO embedding_cache (hash, model, vector, dims, created_at) VALUES (?, ?, ?, ?, ?)",
  )

  const get = (hash: string, model: string) =>
    Effect.try({
      try: () => {
        const row = selectOne.get(hash, model)
        if (!row || !row.vector) return undefined
        return deserializeVector(row.vector)
      },
      catch: (cause) => new CacheError({ message: `Failed to read cache for hash ${hash}`, cause }),
    })

  const getBatch = (hashes: readonly string[], model: string) =>
    Effect.try({
      try: () => {
        const map = new Map<string, readonly number[]>()
        if (hashes.length === 0) return map

        for (const h of hashes) {
          const row = selectOne.get(h, model)
          if (row && row.vector) {
            map.set(h, deserializeVector(row.vector))
          }
        }
        return map
      },
      catch: (cause) => new CacheError({ message: "Failed to batch read embedding cache", cause }),
    })

  const set = (hash: string, model: string, vector: readonly number[]) =>
    Effect.try({
      try: () => {
        const blob = serializeVector(vector)
        insertOne.run(hash, model, blob, vector.length, Date.now())
      },
      catch: (cause) => new CacheError({ message: `Failed to write cache for hash ${hash}`, cause }),
    })

  const setBatch = (entries: readonly CacheEntry[], model: string) =>
    Effect.try({
      try: () => {
        if (entries.length === 0) return
        const now = Date.now()
        db.transaction(() => {
          for (const entry of entries) {
            const blob = serializeVector(entry.vector)
            insertOne.run(entry.hash, model, blob, entry.vector.length, now)
          }
        })()
      },
      catch: (cause) => new CacheError({ message: "Failed to batch write embedding cache", cause }),
    })

  const countStmt = db.prepare<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM embedding_cache WHERE model = ?",
  )
  const countAllStmt = db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM embedding_cache",
  )

  const count = (model?: string) =>
    Effect.try({
      try: () => {
        if (model) {
          const row = countStmt.get(model)
          return row?.count ?? 0
        }
        const row = countAllStmt.get()
        return row?.count ?? 0
      },
      catch: (cause) => new CacheError({ message: "Failed to count embedding cache entries", cause }),
    })

  return Service.of({
    count,
    get,
    getBatch,
    set,
    setBatch,
    hashText,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const db = createDatabase()
    return makeService(db)
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
