import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { testEffect } from "../lib/effect"
import * as MarketplaceRegistry from "@/marketplace/registry"

const layer = LayerNode.compile(LayerNode.group([Database.node, MarketplaceRegistry.node]))
const it = testEffect(layer)

beforeEach(async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.run(sql`DELETE FROM marketplace_install`).pipe(Effect.orDie)
      yield* db.run(sql`DELETE FROM marketplace_source`).pipe(Effect.orDie)
      yield* db.run(sql`DELETE FROM marketplace_registry`).pipe(Effect.orDie)
      yield* db.run(sql`DELETE FROM marketplace_audit`).pipe(Effect.orDie)
    }).pipe(Effect.provide(layer)),
  )
})

describe("marketplace sqlite registry", () => {
  it.effect("stores ordered sources and installs with a monotonic revision", () =>
    Effect.gen(function* () {
      const registry = yield* MarketplaceRegistry.Service
      expect(yield* registry.read()).toEqual({ revision: 0 })

      const first = yield* registry.replace({
        revision: 0,
        sources: [
          { id: "b", name: "B", url: "https://b.example/catalog.json" },
          { id: "a", name: "A", url: "https://a.example/catalog.json" },
        ],
        installed: {
          "source:catalog:item": {
            source: "source",
            catalog: "catalog",
            item: "item",
            name: "Item",
            kind: "bundle",
            version: "1.0.0",
            fingerprint: "fingerprint",
            installed_at: "2026-07-30T00:00:00.000Z",
            updated_at: "2026-07-30T00:00:00.000Z",
            plan: { commands: { review: { template: "review" } } },
            active_plan: { commands: { review: { template: "review" } } },
            receipt: {},
          },
        },
      })

      expect(first.changed).toBe(true)
      expect(first.state.revision).toBe(1)
      const read = yield* registry.read()
      expect(read.sources?.map((source) => source.id)).toEqual(["b", "a"])
      expect(Object.keys(read.installed ?? {})).toEqual(["source:catalog:item"])
      expect(yield* registry.audit()).toMatchObject([
        { revision: 1, action: "replace", data: { sources: 2, installed: 1 } },
      ])
    }),
  )

  it.effect("rejects stale writes and treats identical writes as no-ops", () =>
    Effect.gen(function* () {
      const registry = yield* MarketplaceRegistry.Service
      const first = yield* registry.replace({
        revision: 0,
        sources: [{ id: "a", name: "A", url: "https://a.example/catalog.json" }],
      })
      const noop = yield* registry.replace(first.state)
      expect(noop.changed).toBe(false)
      expect(noop.state.revision).toBe(1)

      const stale = yield* Effect.exit(
        registry.replace({
          revision: 0,
          sources: [{ id: "b", name: "B", url: "https://b.example/catalog.json" }],
        }),
      )
      expect(stale._tag).toBe("Failure")
      expect((yield* registry.read()).sources?.map((source) => source.id)).toEqual(["a"])
    }),
  )
})
