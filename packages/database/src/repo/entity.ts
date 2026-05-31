import { eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { ulid } from "ulid"
import { Database } from "../db"
import type { Entity } from "../schema/entity.sql"
import { EntityTable } from "../schema/entity.sql"
import type { EntityType } from "../schema/types"

export class EntityRepoError extends Schema.TaggedErrorClass<EntityRepoError>()("EntityRepoError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

const mapError = (message: string) => (cause: unknown) => new EntityRepoError({ message, cause })

export interface EntityRepoInterface {
  create(input: {
    type: EntityType
    name: string
    description?: string
    content?: Record<string, unknown>
  }): Effect.Effect<Entity, EntityRepoError>

  get(id: string): Effect.Effect<Option.Option<Entity>, EntityRepoError>

  list(filter?: { type?: EntityType }): Effect.Effect<Entity[], EntityRepoError>

  update(
    id: string,
    input: Partial<{
      name: string
      description: string
      content: Record<string, unknown>
    }>,
  ): Effect.Effect<Entity, EntityRepoError>

  delete(id: string): Effect.Effect<void, EntityRepoError>

  searchByName(query: string): Effect.Effect<Entity[], EntityRepoError>
}

export class EntityRepo extends Context.Service<EntityRepo, EntityRepoInterface>()("@opencode-ai/database/EntityRepo") {
  static layer = Layer.effect(
    EntityRepo,
    Effect.gen(function* () {
      const svc = yield* Database
      const { db } = svc

      return EntityRepo.of({
        create: Effect.fn("EntityRepo.create")(function* (input) {
          const id = ulid()
          const entity = yield* db
            .insert(EntityTable)
            .values({
              id,
              type: input.type,
              name: input.name,
              description: input.description ?? null,
              content: input.content ?? null,
              embedding: null,
            })
            .returning()
            .pipe(Effect.mapError(mapError("Failed to create entity")))
          return entity[0]!
        }),

        get: Effect.fn("EntityRepo.get")(function* (id) {
          const rows = yield* db
            .select()
            .from(EntityTable)
            .where(eq(EntityTable.id, id))
            .pipe(Effect.mapError(mapError("Failed to get entity")))
          return Option.fromNullishOr(rows[0])
        }),

        list: Effect.fn("EntityRepo.list")(function* (filter) {
          if (filter?.type) {
            return yield* db
              .select()
              .from(EntityTable)
              .where(eq(EntityTable.type, filter.type))
              .pipe(Effect.mapError(mapError("Failed to list entities")))
          }
          return yield* db
            .select()
            .from(EntityTable)
            .pipe(Effect.mapError(mapError("Failed to list entities")))
        }),

        update: Effect.fn("EntityRepo.update")(function* (id, input) {
          const entity = yield* db
            .update(EntityTable)
            .set(input)
            .where(eq(EntityTable.id, id))
            .returning()
            .pipe(Effect.mapError(mapError("Failed to update entity")))
          return entity[0]!
        }),

        delete: Effect.fn("EntityRepo.delete")(function* (id) {
          yield* db
            .delete(EntityTable)
            .where(eq(EntityTable.id, id))
            .pipe(Effect.asVoid, Effect.mapError(mapError("Failed to delete entity")))
        }),

        searchByName: Effect.fn("EntityRepo.searchByName")(function* (query) {
          return yield* db
            .select()
            .from(EntityTable)
            .where(eq(EntityTable.name, query))
            .pipe(Effect.mapError(mapError("Failed to search entities by name")))
        }),
      })
    }),
  ).pipe(Layer.provide(Database.layerMemory))
}
