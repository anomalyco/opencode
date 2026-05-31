import { describe, expect, it } from "bun:test"
import { migrate } from "@opencode-ai/effect-drizzle-sqlite/effect-sqlite/migrator"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Database } from "../src/db"
import { EntityRepo } from "../src/repo/entity"
import { RelationRepo } from "../src/repo/relation"
import { EntityType, RelationType } from "../src/schema/types"

const layer = Layer.mergeAll(EntityRepo.layer, RelationRepo.layer, Database.layerMemory)

const run = <A, E>(effect: Effect.Effect<A, E, Database | EntityRepo | RelationRepo>): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const svc = yield* Database
          yield* migrate(svc.db, { migrationsFolder: `${import.meta.dirname}/../migration` })
          return yield* effect
        }),
        layer,
      ),
    ),
  )

describe("GraphDB", () => {
  describe("EntityRepo", () => {
    it("creates and retrieves an entity", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* EntityRepo
          const created = yield* repo.create({ type: EntityType.Tool, name: "test-tool" })
          const retrieved = yield* repo.get(created.id)
          return { created, retrieved }
        }),
      )
      expect(Option.isSome(result.retrieved)).toBe(true)
      if (Option.isSome(result.retrieved)) {
        expect(result.retrieved.value.name).toBe("test-tool")
        expect(result.retrieved.value.type).toBe("tool")
      }
    })

    it("returns None for non-existent entity", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* EntityRepo
          return yield* repo.get("nonexistent-id" as any)
        }),
      )
      expect(Option.isNone(result)).toBe(true)
    })

    it("lists entities by type", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* EntityRepo
          yield* repo.create({ type: EntityType.Tool, name: "tool-1" })
          yield* repo.create({ type: EntityType.Tool, name: "tool-2" })
          yield* repo.create({ type: EntityType.Skill, name: "skill-1" })
          return yield* repo.list({ type: EntityType.Tool })
        }),
      )
      expect(result).toHaveLength(2)
    })

    it("updates an entity", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* EntityRepo
          const created = yield* repo.create({ type: EntityType.Note, name: "old-name" })
          return yield* repo.update(created.id, { name: "new-name" })
        }),
      )
      expect(result.name).toBe("new-name")
    })

    it("deletes an entity", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* EntityRepo
          const created = yield* repo.create({ type: EntityType.Note, name: "to-delete" })
          yield* repo.delete(created.id)
          return yield* repo.get(created.id)
        }),
      )
      expect(Option.isNone(result)).toBe(true)
    })
  })

  describe("RelationRepo", () => {
    it("creates and retrieves a relation", async () => {
      const result = await run(
        Effect.gen(function* () {
          const entities = yield* EntityRepo
          const relations = yield* RelationRepo

          const source = yield* entities.create({ type: EntityType.Tool, name: "source" })
          const target = yield* entities.create({ type: EntityType.Tool, name: "target" })

          const created = yield* relations.create({
            source_id: source.id,
            target_id: target.id,
            type: RelationType.DependsOn,
          })
          return yield* relations.get(created.id)
        }),
      )
      expect(Option.isSome(result)).toBe(true)
    })

    it("lists relations with filters", async () => {
      const result = await run(
        Effect.gen(function* () {
          const entities = yield* EntityRepo
          const relations = yield* RelationRepo

          const a = yield* entities.create({ type: EntityType.Tool, name: "a" })
          const b = yield* entities.create({ type: EntityType.Tool, name: "b" })
          const c = yield* entities.create({ type: EntityType.Tool, name: "c" })

          yield* relations.create({ source_id: a.id, target_id: b.id, type: RelationType.DependsOn })
          yield* relations.create({ source_id: a.id, target_id: c.id, type: RelationType.DependsOn })
          yield* relations.create({ source_id: b.id, target_id: c.id, type: RelationType.References })

          return yield* relations.list({ source_id: a.id })
        }),
      )
      expect(result).toHaveLength(2)
    })

    it("retrieves graph for an entity", async () => {
      const result = await run(
        Effect.gen(function* () {
          const entities = yield* EntityRepo
          const relations = yield* RelationRepo

          const a = yield* entities.create({ type: EntityType.Tool, name: "a" })
          const b = yield* entities.create({ type: EntityType.Tool, name: "b" })
          const c = yield* entities.create({ type: EntityType.Tool, name: "c" })

          yield* relations.create({ source_id: a.id, target_id: b.id, type: RelationType.DependsOn })
          yield* relations.create({ source_id: a.id, target_id: c.id, type: RelationType.Contains })

          return yield* relations.getGraph(a.id)
        }),
      )
      expect(result.relations).toHaveLength(2)
      expect(result.entities).toHaveLength(3)
    })
  })

  describe("cascading deletes", () => {
    it("deletes relations when entity is deleted", async () => {
      const result = await run(
        Effect.gen(function* () {
          const entities = yield* EntityRepo
          const relations = yield* RelationRepo

          const a = yield* entities.create({ type: EntityType.Tool, name: "a" })
          const b = yield* entities.create({ type: EntityType.Tool, name: "b" })

          yield* relations.create({ source_id: a.id, target_id: b.id, type: RelationType.DependsOn })

          yield* entities.delete(a.id)

          return yield* relations.list()
        }),
      )
      expect(result).toHaveLength(0)
    })
  })
})
