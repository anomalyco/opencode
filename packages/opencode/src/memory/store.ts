import { Database, eq, and, sql, lt } from "@/storage/db"
import { ulid } from "ulid"
import { Effect, Layer, ServiceMap } from "effect"
import { MemoryTable } from "./memory.sql"
import { makeRuntime } from "@/effect/run-service"
import { Log } from "@/util/log"
import type { Memory } from "./types"

const log = Log.create({ service: "memory.store" })

function toInfo(row: typeof MemoryTable.$inferSelect): Memory.Info {
  return {
    id: row.id,
    projectPath: row.project_path,
    name: row.topic,
    description: row.description ?? undefined,
    type: row.type as Memory.Type,
    scope: (row.scope ?? "project") as Memory.Scope,
    content: row.content,
    agent: row.agent ?? undefined,
    sessionID: row.session_id ?? undefined,
    accessCount: row.access_count ?? 0,
    relevanceScore: row.relevance_score ?? 1.0,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    timeLastVerified: row.time_last_verified ?? undefined,
    promotedFrom: row.promoted_from ?? undefined,
  }
}

export namespace MemoryStore {
  const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
    Effect.sync(() => Database.use(fn))

  export interface Interface {
    readonly list: (projectPath: string) => Effect.Effect<Memory.Info[]>
    readonly get: (id: string) => Effect.Effect<Memory.Info | undefined>
    readonly create: (input: Memory.Create) => Effect.Effect<Memory.Info>
    readonly update: (input: Memory.Update) => Effect.Effect<Memory.Info | undefined>
    readonly remove: (id: string) => Effect.Effect<void>
    readonly listByType: (projectPath: string, type: Memory.Type) => Effect.Effect<Memory.Info[]>
    readonly listByScope: (projectPath: string, scope: Memory.Scope) => Effect.Effect<Memory.Info[]>
    readonly listByAgent: (projectPath: string, agent: string) => Effect.Effect<Memory.Info[]>
    readonly listStale: (projectPath: string, maxAgeDays: number) => Effect.Effect<Memory.Info[]>
    readonly updateRelevance: (id: string, score: number) => Effect.Effect<void>
    readonly promote: (id: string, targetScope: Memory.Scope) => Effect.Effect<Memory.Info | undefined>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/MemoryStore") {}

  export const layer: Layer.Layer<Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const list = Effect.fn("MemoryStore.list")(function* (projectPath: string) {
        const rows = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(eq(MemoryTable.project_path, projectPath))
            .all(),
        )
        return rows.map(toInfo)
      })

      const get = Effect.fn("MemoryStore.get")(function* (id: string) {
        const row = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(eq(MemoryTable.id, id))
            .get(),
        )
        if (!row) return undefined
        yield* db((d) =>
          d
            .update(MemoryTable)
            .set({ access_count: sql`${MemoryTable.access_count} + 1` })
            .where(eq(MemoryTable.id, id))
            .run(),
        )
        const updated = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(eq(MemoryTable.id, id))
            .get(),
        )
        return updated ? toInfo(updated) : toInfo(row)
      })

      const create = Effect.fn("MemoryStore.create")(function* (input: Memory.Create) {
        const id = ulid()
        const now = Date.now()
        const row = {
          id,
          project_path: input.projectPath,
          topic: input.name,
          type: input.type,
          content: input.content,
          session_id: input.sessionID ?? null,
          access_count: 0,
          scope: input.scope ?? "project",
          description: input.description ?? null,
          agent: input.agent ?? null,
          relevance_score: 1.0,
          time_last_verified: null,
          promoted_from: null,
          time_created: now,
          time_updated: now,
        }
        yield* db((d) => d.insert(MemoryTable).values(row).run())
        log.info("memory created", { id, name: input.name, type: input.type, scope: input.scope ?? "project" })
        return toInfo(row)
      })

      const update = Effect.fn("MemoryStore.update")(function* (input: Memory.Update) {
        const existing = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(eq(MemoryTable.id, input.id))
            .get(),
        )
        if (!existing) return undefined
        const values: Record<string, unknown> = { time_updated: Date.now() }
        if (input.name !== undefined) values.topic = input.name
        if (input.description !== undefined) values.description = input.description
        if (input.type !== undefined) values.type = input.type
        if (input.scope !== undefined) values.scope = input.scope
        if (input.content !== undefined) values.content = input.content
        if (input.relevanceScore !== undefined) values.relevance_score = input.relevanceScore
        if (input.timeLastVerified !== undefined) values.time_last_verified = input.timeLastVerified
        yield* db((d) => d.update(MemoryTable).set(values).where(eq(MemoryTable.id, input.id)).run())
        log.info("memory updated", { id: input.id })
        const updated = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(eq(MemoryTable.id, input.id))
            .get(),
        )
        return updated ? toInfo(updated) : undefined
      })

      const remove = Effect.fn("MemoryStore.remove")(function* (id: string) {
        yield* db((d) => d.delete(MemoryTable).where(eq(MemoryTable.id, id)).run())
        log.info("memory removed", { id })
      })

      const listByType = Effect.fn("MemoryStore.listByType")(function* (projectPath: string, type: Memory.Type) {
        const rows = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(and(eq(MemoryTable.project_path, projectPath), eq(MemoryTable.type, type)))
            .all(),
        )
        return rows.map(toInfo)
      })

      const listByScope = Effect.fn("MemoryStore.listByScope")(function* (projectPath: string, scope: Memory.Scope) {
        const rows = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(and(eq(MemoryTable.project_path, projectPath), eq(MemoryTable.scope, scope)))
            .all(),
        )
        return rows.map(toInfo)
      })

      const listByAgent = Effect.fn("MemoryStore.listByAgent")(function* (projectPath: string, agent: string) {
        const rows = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(and(eq(MemoryTable.project_path, projectPath), eq(MemoryTable.agent, agent)))
            .all(),
        )
        return rows.map(toInfo)
      })

      const listStale = Effect.fn("MemoryStore.listStale")(function* (projectPath: string, maxAgeDays: number) {
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
        const rows = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(and(eq(MemoryTable.project_path, projectPath), lt(MemoryTable.time_updated, cutoff)))
            .all(),
        )
        return rows.map(toInfo)
      })

      const updateRelevance = Effect.fn("MemoryStore.updateRelevance")(function* (id: string, score: number) {
        yield* db((d) =>
          d
            .update(MemoryTable)
            .set({ relevance_score: score, time_updated: Date.now() })
            .where(eq(MemoryTable.id, id))
            .run(),
        )
      })

      const promote = Effect.fn("MemoryStore.promote")(function* (id: string, targetScope: Memory.Scope) {
        const existing = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(eq(MemoryTable.id, id))
            .get(),
        )
        if (!existing) return undefined
        const previousScope = existing.scope ?? "personal"
        yield* db((d) =>
          d
            .update(MemoryTable)
            .set({
              scope: targetScope,
              promoted_from: previousScope,
              time_updated: Date.now(),
            })
            .where(eq(MemoryTable.id, id))
            .run(),
        )
        log.info("memory promoted", { id, from: previousScope, to: targetScope })
        const updated = yield* db((d) =>
          d
            .select()
            .from(MemoryTable)
            .where(eq(MemoryTable.id, id))
            .get(),
        )
        return updated ? toInfo(updated) : undefined
      })

      return Service.of({
        list, get, create, update, remove,
        listByType, listByScope, listByAgent, listStale,
        updateRelevance, promote,
      })
    }),
  )

  export const { runPromise } = makeRuntime(Service, layer)
}
