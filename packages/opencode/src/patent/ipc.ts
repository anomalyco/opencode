import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Option, Schema, Exit } from "effect"
import { AppFileSystem } from "@yunpat/core/filesystem"
import { Config } from "@/config/config"
import path from "path"

const IPCSearchResultSchema = Schema.Struct({
  code: Schema.String,
  description: Schema.String,
})
type IPCSearchResult = Schema.Schema.Type<typeof IPCSearchResultSchema>

const IPCByCodeResultSchema = Schema.Struct({
  code: Schema.String,
  description: Schema.String,
  section: Schema.String,
})
type IPCByCodeResult = Schema.Schema.Type<typeof IPCByCodeResultSchema>

const IPCStatisticsResultSchema = Schema.Struct({
  content: Schema.String,
})

export interface Interface {
  readonly searchByDescription: (keyword: string) => Effect.Effect<Array<IPCSearchResult>>
  readonly getByCode: (code: string) => Effect.Effect<IPCByCodeResult | null>
  readonly getStatistics: (code: string) => Effect.Effect<{ invalidation_rate: number; total_cases: number } | null>
}

export class Service extends Context.Service<Service, Interface>()("@yunpat/PatentIPC") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service

    const getDbPath = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      const dataDir = cfg.patent?.dataDir
      if (!dataDir) return Option.none()
      return Option.some(path.join(dataDir, "patent_kg.db"))
    })

    const withDb = <A>(f: (db: Database) => Effect.Effect<A>) =>
      Effect.gen(function* () {
        const dbPathOpt = yield* getDbPath()
        if (Option.isNone(dbPathOpt)) return Option.none<A>()
        const exists = yield* fs.existsSafe(dbPathOpt.value)
        if (!exists) return Option.none<A>()
        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new Database(dbPathOpt.value, { readonly: true })),
          (db) => Effect.sync(() => db.close()),
        )
        return Option.some(yield* f(db))
      }).pipe(Effect.scoped)

    const searchByDescription = Effect.fn("PatentIPC.searchByDescription")(function* (keyword: string) {
      const resultsOpt = yield* withDb((db) =>
        Effect.sync(() => {
          const stmt = db.prepare("SELECT code, description FROM ipc_fts WHERE ipc_fts MATCH ? ORDER BY rank LIMIT 100")
          return stmt.all(keyword)
        }),
      )
      if (Option.isNone(resultsOpt)) return []
      const decoded = yield* Effect.forEach(resultsOpt.value, (row) =>
        Effect.gen(function* () {
          const result = Schema.decodeUnknownExit(IPCSearchResultSchema)(row, { errors: "all" })
          if (Exit.isSuccess(result)) return result.value
          return null
        }),
      )
      return decoded.filter((r): r is IPCSearchResult => r !== null)
    })

    const getByCode = Effect.fn("PatentIPC.getByCode")(function* (code: string) {
      const resultOpt = yield* withDb((db) =>
        Effect.sync(() => {
          const stmt = db.prepare("SELECT code, description, section FROM ipc_classification WHERE code = ?")
          return stmt.get(code)
        }),
      )
      if (Option.isNone(resultOpt) || !resultOpt.value) return null
      const decodedExit = Schema.decodeUnknownExit(IPCByCodeResultSchema)(resultOpt.value, { errors: "all" })
      if (!Exit.isSuccess(decodedExit)) return null
      return decodedExit.value
    })

    const getStatistics = Effect.fn("PatentIPC.getStatistics")(function* (code: string) {
      const resultOpt = yield* withDb((db) =>
        Effect.sync(() => {
          const stmt = db.prepare("SELECT content FROM nodes WHERE node_type = 'IPC' AND content LIKE ?")
          const pattern = `%IPC分类号 ${code}%`
          return stmt.get(pattern)
        }),
      )
      if (Option.isNone(resultOpt) || !resultOpt.value) return null

      const decodedExit = Schema.decodeUnknownExit(IPCStatisticsResultSchema)(resultOpt.value, { errors: "all" })
      if (!Exit.isSuccess(decodedExit)) return null

      const match = decodedExit.value.content.match(/无效率\s+([\d.]+)%/)
      const rateMatch = decodedExit.value.content.match(/案件数量[:：]\s*(\d+)/)
      if (!match || !rateMatch) return null

      return {
        invalidation_rate: parseFloat(match[1]),
        total_cases: parseInt(rateMatch[1], 10),
      }
    })

    return Service.of({ searchByDescription, getByCode, getStatistics })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)