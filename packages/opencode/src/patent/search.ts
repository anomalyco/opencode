import path from "path"
import { Config } from "@/config/config"
import { Context, Effect, Layer, Schema, Exit } from "effect"
import type Database from "bun:sqlite"

const PatentRecord = Schema.Struct({
  patentId: Schema.String,
  title: Schema.String,
  abstract: Schema.String,
  applicant: Schema.String,
  ipc: Schema.String,
})
export type PatentRecord = Schema.Schema.Type<typeof PatentRecord>

class PatentSearchUnavailableError extends Schema.TaggedErrorClass<PatentSearchUnavailableError>()(
  "PatentSearchUnavailableError",
  { message: Schema.String },
) {}

export interface Interface {
  readonly search: (query: {
    keyword?: string
    ipc?: string
    applicant?: string
    limit?: number
  }) => Effect.Effect<PatentRecord[], PatentSearchUnavailableError>
  readonly isAvailable: () => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentSearch") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const isAvailable = Effect.fn("PatentSearch.isAvailable")(function* () {
      const patentConfig = (yield* config.get()).patent?.search
      return patentConfig?.backend !== "none" && patentConfig?.backend !== undefined
    })

    const search = Effect.fn("PatentSearch.search")(
      function* (query: {
        keyword?: string
        ipc?: string
        applicant?: string
        limit?: number
      }) {
        const cfg = (yield* config.get()).patent
        if (!cfg?.search?.backend || cfg.search.backend === "none") {
          return yield* new PatentSearchUnavailableError({ message: "Patent search backend not configured" })
        }

        if (cfg.search.backend === "local") {
          const dbPath =
            cfg.search.connectionString ?? path.join(cfg.dataDir ?? "", "patent_search.db")
          const { existsSync } = yield* Effect.promise(() => import("fs"))
          if (!existsSync(dbPath)) {
            return yield* new PatentSearchUnavailableError({
              message: `Patent database not found at ${dbPath}`,
            })
          }

          const rows = yield* Effect.gen(function* () {
            const { Database } = yield* Effect.promise(() => import("bun:sqlite"))
            const db = yield* Effect.acquireRelease(
              Effect.succeed(new Database(dbPath, { readonly: true }) as Database),
              (db) => Effect.sync(() => db.close()),
            )

            const conditions: string[] = []
            const params: string[] = []
            if (query.keyword) {
              conditions.push("(title LIKE ? OR abstract LIKE ?)")
              params.push(`%${query.keyword}%`, `%${query.keyword}%`)
            }
            if (query.ipc) {
              conditions.push("ipc LIKE ?")
              params.push(`${query.ipc}%`)
            }
            if (query.applicant) {
              conditions.push("applicant LIKE ?")
              params.push(`%${query.applicant}%`)
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
            const limit = Math.min(query.limit ?? 10, 100)
            const sql = `SELECT patentId, title, abstract, applicant, ipc FROM patents ${where} LIMIT ${limit}`

            return Effect.succeed(db.query(sql).all(...params) as Record<string, unknown>[])
          }).pipe(Effect.scoped)

          const decoded = yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const decoded = Schema.decodeUnknownExit(PatentRecord)(row, { errors: "all" })
              if (Exit.isSuccess(decoded)) return decoded.value
              yield* Effect.logWarning("PatentSearch: schema decode failed", decoded)
              return null
            }),
          )
          return decoded.filter((v): v is PatentRecord => v !== null)
        }

        return yield* new PatentSearchUnavailableError({
          message: `Patent search backend '${cfg.search.backend}' not implemented`,
        })
      },
    )

    return Service.of({ search, isAvailable })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as PatentSearch from "./search"