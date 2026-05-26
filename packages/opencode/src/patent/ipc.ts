import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import path from "path"

export interface Interface {
  readonly searchByDescription: (keyword: string) => Effect.Effect<Array<{ code: string; description: string }>>
  readonly getByCode: (code: string) => Effect.Effect<{ code: string; description: string; section: string } | null>
  readonly getStatistics: (code: string) => Effect.Effect<{ invalidation_rate: number; total_cases: number } | null>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentIPC") {}

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

    const openDb = Effect.fnUntraced(function* (dbPath: string) {
      const exists = yield* fs.existsSafe(dbPath)
      if (!exists) return Option.none()
      return Option.some(new Database(dbPath, { readonly: true }))
    })

    const searchByDescription = Effect.fn("PatentIPC.searchByDescription")(function* (keyword: string) {
      const dbPathOpt = yield* getDbPath()
      if (Option.isNone(dbPathOpt)) return []
      const dbOpt = yield* openDb(dbPathOpt.value)
      if (Option.isNone(dbOpt)) return []
      const db = dbOpt.value

      try {
        const stmt = db.prepare("SELECT code, description FROM ipc_fts WHERE ipc_fts MATCH ? ORDER BY rank LIMIT 100")
        const results = stmt.all(keyword) as Array<{ code: string; description: string }>
        return results
      } finally {
        db.close()
      }
    })

    const getByCode = Effect.fn("PatentIPC.getByCode")(function* (code: string) {
      const dbPathOpt = yield* getDbPath()
      if (Option.isNone(dbPathOpt)) return null
      const dbOpt = yield* openDb(dbPathOpt.value)
      if (Option.isNone(dbOpt)) return null
      const db = dbOpt.value

      try {
        const stmt = db.prepare("SELECT code, description, section FROM ipc_classification WHERE code = ?")
        const result = stmt.get(code) as { code: string; description: string; section: string } | undefined
        return result ?? null
      } finally {
        db.close()
      }
    })

    const getStatistics = Effect.fn("PatentIPC.getStatistics")(function* (code: string) {
      const dbPathOpt = yield* getDbPath()
      if (Option.isNone(dbPathOpt)) return null
      const dbOpt = yield* openDb(dbPathOpt.value)
      if (Option.isNone(dbOpt)) return null
      const db = dbOpt.value

      try {
        const stmt = db.prepare("SELECT content FROM nodes WHERE node_type = 'IPC' AND content LIKE ?")
        const pattern = `%IPC分类号 ${code}%`
        const result = stmt.get(pattern) as { content: string } | undefined
        if (!result) return null

        const match = result.content.match(/无效率\s+([\d.]+)%/)
        const rateMatch = result.content.match(/案件数量[:：]\s*(\d+)/)
        if (!match || !rateMatch) return null

        return {
          invalidation_rate: parseFloat(match[1]),
          total_cases: parseInt(rateMatch[1], 10),
        }
      } finally {
        db.close()
      }
    })

    return Service.of({ searchByDescription, getByCode, getStatistics })
  }),
)

export const defaultLayer = layer