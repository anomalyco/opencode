import { isDeepStrictEqual } from "util"
import { Context, Effect, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import type { MarketplaceInstalled, MarketplaceSource, MarketplaceState } from "@opencode-ai/core/marketplace"

const REGISTRY_ID = 1

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("MarketplaceRegistryConflictError", {
  expected: Schema.Number,
  actual: Schema.Number,
}) {
  override get message() {
    return `Marketplace registry changed concurrently (expected revision ${this.expected}, actual ${this.actual})`
  }
}

export type ReplaceResult = {
  state: MarketplaceState
  changed: boolean
}

export interface Interface {
  readonly read: () => Effect.Effect<MarketplaceState>
  readonly replace: (state: MarketplaceState) => Effect.Effect<ReplaceResult, ConflictError>
  readonly audit: (limit?: number) => Effect.Effect<
    Array<{
      id: number
      revision: number
      action: string
      data: Record<string, unknown>
      time_created: number
    }>
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplaceRegistry") {}

type Executor = Pick<Database.Interface["db"], "all" | "run">

function parseJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T
  return structuredClone(value) as T
}

function normalize(state: MarketplaceState): Omit<MarketplaceState, "revision"> {
  const value: Omit<MarketplaceState, "revision"> = {}
  if (state.sources !== undefined) value.sources = structuredClone(state.sources)
  if (state.installed !== undefined) value.installed = structuredClone(state.installed)
  return JSON.parse(JSON.stringify(value)) as Omit<MarketplaceState, "revision">
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const readFrom = Effect.fnUntraced(function* (executor: Executor) {
      const now = Date.now()
      yield* executor
        .run(
          sql`INSERT OR IGNORE INTO marketplace_registry (id, revision, time_updated)
              VALUES (${REGISTRY_ID}, 0, ${now})`,
        )
        .pipe(Effect.orDie)

      const meta = (yield* executor
        .all<{ revision: number }>(sql`SELECT revision FROM marketplace_registry WHERE id = ${REGISTRY_ID} LIMIT 1`)
        .pipe(Effect.orDie))[0]

      const sourceRows = yield* executor
        .all<{ data: unknown }>(sql`SELECT data FROM marketplace_source ORDER BY position ASC, id ASC`)
        .pipe(Effect.orDie)
      const installRows = yield* executor
        .all<{
          key: string
          data: unknown
        }>(sql`SELECT key, data FROM marketplace_install ORDER BY position ASC, key ASC`)
        .pipe(Effect.orDie)

      const sources = sourceRows.map((row) => parseJson<MarketplaceSource>(row.data))
      const installed = Object.fromEntries(
        installRows.map((row) => [row.key, parseJson<MarketplaceInstalled>(row.data)] as const),
      )

      return {
        revision: meta?.revision ?? 0,
        ...(sources.length ? { sources } : {}),
        ...(installRows.length ? { installed } : {}),
      } satisfies MarketplaceState
    })

    const read = Effect.fn("MarketplaceRegistry.read")(function* () {
      return yield* readFrom(db)
    })

    const replace = Effect.fn("MarketplaceRegistry.replace")(function* (state: MarketplaceState) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* readFrom(tx as unknown as Executor)
            const desired = normalize(state)
            const existing = normalize(current)
            if (isDeepStrictEqual(existing, desired)) return { state: current, changed: false }

            const expected = state.revision ?? 0
            const actual = current.revision ?? 0
            if (expected !== actual) return yield* new ConflictError({ expected, actual })

            const now = Date.now()
            const revision = actual + 1
            yield* tx
              .run(
                sql`UPDATE marketplace_registry
                  SET revision = ${revision}, time_updated = ${now}
                  WHERE id = ${REGISTRY_ID}`,
              )
              .pipe(Effect.orDie)
            for (const source of current.sources ?? []) {
              if ((desired.sources ?? []).some((candidate) => candidate.id === source.id)) continue
              yield* tx.run(sql`DELETE FROM marketplace_source WHERE id = ${source.id}`).pipe(Effect.orDie)
            }
            for (const key of Object.keys(current.installed ?? {})) {
              if (key in (desired.installed ?? {})) continue
              yield* tx.run(sql`DELETE FROM marketplace_install WHERE key = ${key}`).pipe(Effect.orDie)
            }

            for (const [position, source] of (desired.sources ?? []).entries()) {
              yield* tx
                .run(
                  sql`INSERT INTO marketplace_source (id, data, position, time_created, time_updated)
                    VALUES (${source.id}, ${JSON.stringify(source)}, ${position}, ${now}, ${now})
                    ON CONFLICT(id) DO UPDATE SET
                      data = excluded.data,
                      position = excluded.position,
                      time_updated = excluded.time_updated`,
                )
                .pipe(Effect.orDie)
            }

            for (const [position, [key, installed]] of Object.entries(desired.installed ?? {}).entries()) {
              yield* tx
                .run(
                  sql`INSERT INTO marketplace_install (key, data, position, time_created, time_updated)
                    VALUES (${key}, ${JSON.stringify(installed)}, ${position}, ${now}, ${now})
                    ON CONFLICT(key) DO UPDATE SET
                      data = excluded.data,
                      position = excluded.position,
                      time_updated = excluded.time_updated`,
                )
                .pipe(Effect.orDie)
            }

            yield* tx
              .run(
                sql`INSERT INTO marketplace_audit (revision, action, data, time_created)
                    VALUES (${revision}, ${"replace"}, ${JSON.stringify({
                      sources: desired.sources?.length ?? 0,
                      installed: Object.keys(desired.installed ?? {}).length,
                    })}, ${now})`,
              )
              .pipe(Effect.orDie)

            return {
              state: {
                ...structuredClone(desired),
                revision,
              },
              changed: true,
            }
          }),
        )
        .pipe(Effect.catch((error) => (error instanceof ConflictError ? Effect.fail(error) : Effect.die(error))))
    })

    const audit = Effect.fn("MarketplaceRegistry.audit")(function* (limit = 100) {
      const rows = yield* db
        .all<{
          id: number
          revision: number
          action: string
          data: unknown
          time_created: number
        }>(
          sql`SELECT id, revision, action, data, time_created FROM marketplace_audit
              ORDER BY id DESC LIMIT ${Math.max(1, Math.min(limit, 500))}`,
        )
        .pipe(Effect.orDie)
      return rows.map((row) => ({ ...row, data: parseJson<Record<string, unknown>>(row.data) }))
    })

    return Service.of({ read, replace, audit })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Database.node],
})
