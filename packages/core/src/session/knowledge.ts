export * as SessionKnowledge from "./knowledge"

import { and, eq, gt, gte, like, lt, or, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionKnowledgeTable } from "./sql"

export const FactType = Schema.Literals([
  "architecture",
  "pattern",
  "constraint",
  "decision",
  "user-preference",
])
export type FactType = typeof FactType.Type

export const Fact = Schema.Struct({
  type: FactType,
  content: Schema.String,
  context: Schema.String,
  sessionID: SessionSchema.ID,
  timeCreated: Schema.Finite,
  ttl: Schema.Finite.pipe(Schema.optional),
})
export type Fact = typeof Fact.Type

export const KnowledgeID = Schema.String.pipe(Schema.brand("KnowledgeID"))
export type KnowledgeID = typeof KnowledgeID.Type

export interface Interface {
  readonly record: (input: {
    readonly sessionID: SessionSchema.ID
    readonly type: FactType
    readonly content: string
    readonly context: string
    readonly ttl?: number
  }) => Effect.Effect<void>

  readonly query: (input: {
    readonly sessionID: SessionSchema.ID
    readonly key?: string
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<Fact>>

  readonly queryByContext: (context: string) => Effect.Effect<ReadonlyArray<Fact>>

  readonly pruneExpired: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionKnowledge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const nextID = Effect.sync(() => "knw_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))

    return Service.of({
      record: Effect.fn("SessionKnowledge.record")(function* (input) {
        const id = yield* nextID
        yield* db
          .insert(SessionKnowledgeTable)
          .values({
            id,
            session_id: input.sessionID,
            key: input.type,
            value: input.content,
            context: input.context,
            time_created: Date.now(),
            ttl: input.ttl ?? null,
          })
          .run()
          .pipe(Effect.orDie)
      }),

      query: Effect.fn("SessionKnowledge.query")(function* (input) {
        const rows = yield* db
          .select()
          .from(SessionKnowledgeTable)
          .where(
            and(
              eq(SessionKnowledgeTable.session_id, input.sessionID),
              input.key ? eq(SessionKnowledgeTable.key, input.key) : undefined,
            ),
          )
          .orderBy(sql`${SessionKnowledgeTable.time_created} DESC`)
        .limit(input.limit ?? 20)
        .all()
        .pipe(Effect.orDie)
        return rows.map((row): Fact => ({
          type: row.key as FactType,
          content: row.value as string,
          context: row.context,
          sessionID: row.session_id,
          timeCreated: row.time_created,
          ...(row.ttl ? { ttl: row.ttl } : {}),
        }))
      }),

      queryByContext: Effect.fn("SessionKnowledge.queryByContext")(function* (context) {
        const rows = yield* db
          .select()
          .from(SessionKnowledgeTable)
          .where(
            or(
              like(SessionKnowledgeTable.context, `%${context}%`),
              like(SessionKnowledgeTable.value, `%${context}%`),
            ),
          )
          .orderBy(sql`${SessionKnowledgeTable.time_created} DESC`)
        .limit(10)
        .all()
        .pipe(Effect.orDie)
        return rows.map((row): Fact => ({
          type: row.key as FactType,
          content: row.value as string,
          context: row.context,
          sessionID: row.session_id,
          timeCreated: row.time_created,
          ...(row.ttl ? { ttl: row.ttl } : {}),
        }))
      }),

      pruneExpired: Effect.fn("SessionKnowledge.pruneExpired")(function* () {
        const now = Date.now()
        yield* db
          .delete(SessionKnowledgeTable)
          .where(and(gt(SessionKnowledgeTable.ttl, 0), lt(SessionKnowledgeTable.ttl, now)))
          .run()
          .pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node],
})
