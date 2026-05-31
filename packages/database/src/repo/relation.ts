import { and, eq, inArray, or } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { ulid } from "ulid"
import { Database } from "../db"
import type { Entity } from "../schema/entity.sql"
import { EntityTable } from "../schema/entity.sql"

import type { Relation } from "../schema/relation.sql"
import { RelationTable } from "../schema/relation.sql"
import type { RelationType } from "../schema/types"

export class RelationRepoError extends Schema.TaggedErrorClass<RelationRepoError>()("RelationRepoError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

const mapError = (message: string) => (cause: unknown) => new RelationRepoError({ message, cause })

export interface RelationRepoInterface {
  create(input: {
    source_id: string
    target_id: string
    type: RelationType
    metadata?: Record<string, unknown>
  }): Effect.Effect<Relation, RelationRepoError>

  get(id: string): Effect.Effect<Option.Option<Relation>, RelationRepoError>

  list(filter?: {
    source_id?: string
    target_id?: string
    type?: RelationType
  }): Effect.Effect<Relation[], RelationRepoError>

  delete(id: string): Effect.Effect<void, RelationRepoError>

  getGraph(entityId: string): Effect.Effect<
    {
      entities: Entity[]
      relations: Relation[]
    },
    RelationRepoError
  >
}

export class RelationRepo extends Context.Service<RelationRepo, RelationRepoInterface>()(
  "@opencode-ai/database/RelationRepo",
) {
  static layer = Layer.effect(
    RelationRepo,
    Effect.gen(function* () {
      const svc = yield* Database
      const { db } = svc

      return RelationRepo.of({
        create: Effect.fn("RelationRepo.create")(function* (input) {
          const id = ulid()
          const relation = yield* db
            .insert(RelationTable)
            .values({
              id,
              source_id: input.source_id,
              target_id: input.target_id,
              type: input.type,
              metadata: input.metadata ?? null,
            })
            .returning()
            .pipe(Effect.mapError(mapError("Failed to create relation")))
          return relation[0]!
        }),

        get: Effect.fn("RelationRepo.get")(function* (id) {
          const rows = yield* db
            .select()
            .from(RelationTable)
            .where(eq(RelationTable.id, id))
            .pipe(Effect.mapError(mapError("Failed to get relation")))
          return Option.fromNullishOr(rows[0])
        }),

        list: Effect.fn("RelationRepo.list")(function* (filter) {
          const conditions: SQL[] = []
          if (filter?.source_id) conditions.push(eq(RelationTable.source_id, filter.source_id))
          if (filter?.target_id) conditions.push(eq(RelationTable.target_id, filter.target_id))
          if (filter?.type) conditions.push(eq(RelationTable.type, filter.type))

          const query =
            conditions.length > 0
              ? db
                  .select()
                  .from(RelationTable)
                  .where(and(...conditions))
              : db.select().from(RelationTable)

          return yield* query.pipe(Effect.mapError(mapError("Failed to list relations")))
        }),

        delete: Effect.fn("RelationRepo.delete")(function* (id) {
          yield* db
            .delete(RelationTable)
            .where(eq(RelationTable.id, id))
            .pipe(Effect.asVoid, Effect.mapError(mapError("Failed to delete relation")))
        }),

        getGraph: Effect.fn("RelationRepo.getGraph")(function* (entityId) {
          const relations = yield* db
            .select()
            .from(RelationTable)
            .where(or(eq(RelationTable.source_id, entityId), eq(RelationTable.target_id, entityId)))
            .pipe(Effect.mapError(mapError("Failed to get graph")))

          const relatedIds = new Set<string>()
          for (const rel of relations) {
            relatedIds.add(rel.source_id)
            relatedIds.add(rel.target_id)
          }

          const entities =
            relatedIds.size > 0
              ? yield* db
                  .select()
                  .from(EntityTable)
                  .where(inArray(EntityTable.id, Array.from(relatedIds)))
                  .pipe(Effect.mapError(mapError("Failed to get graph entities")))
              : []

          return { entities, relations }
        }),
      })
    }),
  ).pipe(Layer.provide(Database.layerMemory))
}
