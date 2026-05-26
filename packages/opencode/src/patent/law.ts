import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import path from "path"

export interface Interface {
  readonly searchLaw: (keyword: string) => Effect.Effect<Array<{ id: string; name: string; level: string }>>
  readonly getByCategory: (category: string) => Effect.Effect<Array<{ id: string; name: string }>>
  readonly getLawContent: (id: string) => Effect.Effect<string, AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentLaw") {}

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

    const openDb = Effect.fnUntraced(function* (dbPath: string) {
      const exists = yield* fs.existsSafe(dbPath)
      if (!exists) return Option.none()
      return Option.some(new Database(dbPath, { readonly: true }))
    })

    const searchLaw = Effect.fn("PatentLaw.searchLaw")(function* (keyword: string) {
      const dbPathOpt = yield* getDbPath()
      if (Option.isNone(dbPathOpt)) return []
      const dbOpt = yield* openDb(dbPathOpt.value)
      if (Option.isNone(dbOpt)) return []
      const db = dbOpt.value

      try {
        const stmt = db.prepare(
          "SELECT id, name, level FROM law WHERE name LIKE ? OR subtitle LIKE ? ORDER BY name",
        )
        const pattern = `%${keyword}%`
        const results = stmt.all(pattern, pattern) as Array<{ id: string; name: string; level: string }>
        return results
      } finally {
        db.close()
      }
    })

    const getByCategory = Effect.fn("PatentLaw.getByCategory")(function* (category: string) {
      const dbPathOpt = yield* getDbPath()
      if (Option.isNone(dbPathOpt)) return []
      const dbOpt = yield* openDb(dbPathOpt.value)
      if (Option.isNone(dbOpt)) return []
      const db = dbOpt.value

      try {
        const stmt = db.prepare(`
          SELECT l.id, l.name
          FROM law l
          JOIN category c ON l.category_id = c.id
          WHERE c.name = ?
          ORDER BY l.name
        `)
        const results = stmt.all(category) as Array<{ id: string; name: string }>
        return results
      } finally {
        db.close()
      }
    })

    const getLawContent = Effect.fn("PatentLaw.getLawContent")(function* (id: string) {
      const dbPathOpt = yield* getDbPath()
      if (Option.isNone(dbPathOpt)) return ""
      const dbOpt = yield* openDb(dbPathOpt.value)
      if (Option.isNone(dbOpt)) return ""
      const db = dbOpt.value

      try {
        const stmt = db.prepare("SELECT filename FROM law WHERE id = ?")
        const result = stmt.get(id) as { filename: string } | undefined
        if (!result || !result.filename) return ""

        const filePath = path.join(path.dirname(dbPathOpt.value), result.filename)
        const content = yield* fs.readFileStringSafe(filePath)
        return content ?? ""
      } finally {
        db.close()
      }
    })

    return Service.of({ searchLaw, getByCategory, getLawContent })
  }),
)

export const defaultLayer = layer