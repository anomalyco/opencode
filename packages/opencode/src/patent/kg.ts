import path from "path"
import { Effect, Layer, Context, Schema, Exit } from "effect"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type Database from "bun:sqlite"

export interface Interface {
  readonly queryNode: (name: string) => Effect.Effect<KGNode | null>
  readonly queryRelated: (nodeId: string, relation?: string) => Effect.Effect<KGEdge[]>
  readonly queryByLawRef: (ref: string) => Effect.Effect<KGNode[]>
  readonly fullTextSearch: (query: string) => Effect.Effect<KGNode[]>
}

export class Service extends Context.Service<Service, Interface>()("@yunpat/PatentKG") {}

const KGNodeSchema = Schema.Struct({
  id: Schema.String,
  node_type: Schema.String,
  name: Schema.String,
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  law_refs_count: Schema.optional(Schema.Number),
  source: Schema.optional(Schema.String),
  full_ref: Schema.optional(Schema.String),
  chapter: Schema.optional(Schema.String),
  article_number: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
})
export type KGNode = Schema.Schema.Type<typeof KGNodeSchema>

const KGEdgeSchema = Schema.Struct({
  id: Schema.Number,
  source: Schema.String,
  target: Schema.String,
  relation: Schema.String,
})
export type KGEdge = Schema.Schema.Type<typeof KGEdgeSchema>

export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const state = yield* InstanceState.make<{ db: Database | null }>(
      Effect.fn("PatentKG.state")(() =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const dataDir = cfg.patent?.dataDir

          if (!dataDir) {
            yield* Effect.logWarning("patent.dataDir not configured, PatentKG service disabled")
            return { db: null }
          }

          const dbPath = path.join(dataDir, "patent_kg.db")
          const { existsSync } = yield* Effect.promise(() => import("fs"))
          if (!existsSync(dbPath)) {
            yield* Effect.logWarning(`patent_kg.db not found at ${dbPath}, PatentKG service disabled`)
            return { db: null }
          }

          const { Database } = yield* Effect.promise(() => import("bun:sqlite"))
          const db = yield* Effect.acquireRelease(
            Effect.succeed(new Database(dbPath, { readonly: true })),
            (db) => Effect.sync(() => db.close()),
          )
          return { db }
        }),
      ),
    )

    const queryNode = Effect.fn("PatentKG.queryNode")(function* (name: string) {
      const { db } = yield* InstanceState.get(state)
      if (!db) return null

      const row = db
        .query("SELECT * FROM nodes WHERE name = ? LIMIT 1")
        .get(name) as Record<string, unknown> | null

      if (!row) return null
      const decoded = Schema.decodeUnknownExit(KGNodeSchema)(row, { errors: "all" })
      if (Exit.isSuccess(decoded)) return decoded.value
      yield* Effect.logWarning("PatentKG: schema decode failed", decoded)
      return null
    })

    const queryRelated = Effect.fn("PatentKG.queryRelated")(
      function* (nodeId: string, relation?: string) {
        const { db } = yield* InstanceState.get(state)
        if (!db) return []

        const query = relation
          ? db.query("SELECT * FROM edges WHERE source = ? AND relation = ?").all(nodeId, relation)
          : db.query("SELECT * FROM edges WHERE source = ?").all(nodeId)

        const result = yield* Effect.forEach(query, (row: unknown) =>
          Effect.gen(function* () {
            const decoded = Schema.decodeUnknownExit(KGEdgeSchema)(row, { errors: "all" })
            if (Exit.isSuccess(decoded)) return decoded.value
            yield* Effect.logWarning("PatentKG: schema decode failed", decoded)
            return null
          }),
        )
        return result.filter((v): v is KGEdge => v !== null)
      },
    )

    const queryByLawRef = Effect.fn("PatentKG.queryByLawRef")(function* (ref: string) {
      const { db } = yield* InstanceState.get(state)
      if (!db) return []

      const rows = db.query("SELECT * FROM nodes WHERE full_ref = ?").all(ref) as Record<
        string,
        unknown
      >[]

      const result = yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const decoded = Schema.decodeUnknownExit(KGNodeSchema)(row, { errors: "all" })
          if (Exit.isSuccess(decoded)) return decoded.value
          yield* Effect.logWarning("PatentKG: schema decode failed", decoded)
          return null
        }),
      )
      return result.filter((v): v is KGNode => v !== null)
    })

    const fullTextSearch = Effect.fn("PatentKG.fullTextSearch")(function* (query: string) {
      const { db } = yield* InstanceState.get(state)
      if (!db) return []

      const rows = db
        .query(`SELECT * FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY rank LIMIT 100`)
        .all(query) as Record<string, unknown>[]

      const result = yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const decoded = Schema.decodeUnknownExit(KGNodeSchema)(row, { errors: "all" })
          if (Exit.isSuccess(decoded)) return decoded.value
          yield* Effect.logWarning("PatentKG: schema decode failed", decoded)
          return null
        }),
      )
      return result.filter((v): v is KGNode => v !== null)
    })

    return Service.of({ queryNode, queryRelated, queryByLawRef, fullTextSearch })
  }),
)

export * as PatentKG from "./kg"