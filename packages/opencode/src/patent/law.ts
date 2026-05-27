import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Option, Schema, Exit } from "effect"
import { AppFileSystem } from "@yunpat/core/filesystem"
import { Config } from "@/config/config"
import path from "path"

const LawSearchResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  level: Schema.String,
})
type LawSearchResult = Schema.Schema.Type<typeof LawSearchResultSchema>

const LawByCategoryResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})
type LawByCategoryResult = Schema.Schema.Type<typeof LawByCategoryResultSchema>

const LawFileResultSchema = Schema.Struct({
  filename: Schema.String,
})

export interface Interface {
  readonly searchLaw: (keyword: string) => Effect.Effect<Array<LawSearchResult>>
  readonly getByCategory: (category: string) => Effect.Effect<Array<LawByCategoryResult>>
  readonly getLawContent: (id: string) => Effect.Effect<string, AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@yunpat/PatentLaw") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service

    const getDbPath = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      const dataDir = cfg.patent?.dataDir
      if (!dataDir) return Option.none()
      return Option.some(path.join(dataDir, "laws.db"))
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

    const validateFilename = (filename: string) => {
      if (filename.includes("..") || filename.startsWith("/")) {
        return Option.none<string>()
      }
      return Option.some(filename)
    }

    const searchLaw = Effect.fn("PatentLaw.searchLaw")(function* (keyword: string) {
      const resultsOpt = yield* withDb((db) =>
        Effect.sync(() => {
          const stmt = db.prepare(
            "SELECT id, name, level FROM law WHERE name LIKE ? OR subtitle LIKE ? ORDER BY name",
          )
          const pattern = `%${keyword}%`
          return stmt.all(pattern, pattern)
        }),
      )
      if (Option.isNone(resultsOpt)) return []
      const decoded = yield* Effect.forEach(resultsOpt.value, (row) =>
        Effect.gen(function* () {
          const result = Schema.decodeUnknownExit(LawSearchResultSchema)(row, { errors: "all" })
          if (Exit.isSuccess(result)) return result.value
          return null
        }),
      )
      return decoded.filter((r): r is LawSearchResult => r !== null)
    })

    const getByCategory = Effect.fn("PatentLaw.getByCategory")(function* (category: string) {
      const resultsOpt = yield* withDb((db) =>
        Effect.sync(() => {
          const stmt = db.prepare(`
            SELECT l.id, l.name
            FROM law l
            JOIN category c ON l.category_id = c.id
            WHERE c.name = ?
            ORDER BY l.name
          `)
          return stmt.all(category)
        }),
      )
      if (Option.isNone(resultsOpt)) return []
      const decoded = yield* Effect.forEach(resultsOpt.value, (row) =>
        Effect.gen(function* () {
          const result = Schema.decodeUnknownExit(LawByCategoryResultSchema)(row, { errors: "all" })
          if (Exit.isSuccess(result)) return result.value
          return null
        }),
      )
      return decoded.filter((r): r is LawByCategoryResult => r !== null)
    })

    const getLawContent = Effect.fn("PatentLaw.getLawContent")(function* (id: string) {
      const resultOpt = yield* withDb((db) =>
        Effect.sync(() => {
          const stmt = db.prepare("SELECT filename FROM law WHERE id = ?")
          return stmt.get(id)
        }),
      )
      if (Option.isNone(resultOpt) || !resultOpt.value) return ""

      const decodedExit = Schema.decodeUnknownExit(LawFileResultSchema)(resultOpt.value, { errors: "all" })
      if (!Exit.isSuccess(decodedExit)) return ""

      const filenameOpt = validateFilename(decodedExit.value.filename)
      if (Option.isNone(filenameOpt)) return ""

      const dbPathOpt = yield* getDbPath()
      if (Option.isNone(dbPathOpt)) return ""

      const filePath = path.join(path.dirname(dbPathOpt.value), filenameOpt.value)
      const content = yield* fs.readFileStringSafe(filePath)
      return content ?? ""
    })

    return Service.of({ searchLaw, getByCategory, getLawContent })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)