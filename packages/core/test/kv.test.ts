import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode/core/database/database"
import { KV } from "@opencode/core/kv"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([KV.node, Database.node])))

describe("KV", () => {
  it.effect("stores, replaces, and removes JSON values", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      expect(yield* kv.get("wellknown:sources")).toBeUndefined()

      yield* kv.set("wellknown:sources", ["https://example.com"])
      expect(yield* kv.get("wellknown:sources")).toEqual(["https://example.com"])

      yield* kv.set("wellknown:sources", ["https://example.com", "https://example.org"])
      expect(yield* kv.get("wellknown:sources")).toEqual(["https://example.com", "https://example.org"])

      yield* kv.remove("wellknown:sources")
      yield* kv.remove("wellknown:sources")
      expect(yield* kv.get("wellknown:sources")).toBeUndefined()
    }),
  )

  it.effect("scans prefixes in deterministic pages", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      const prefix = "scan:%_:/雪/"
      yield* Effect.forEach(
        [
          [`${prefix}beta`, { order: 2 }],
          [`${prefix}alpha`, { order: 1 }],
          [`${prefix}éclair`, { order: 3 }],
          ["scan:other", { order: 0 }],
        ] as const,
        ([key, value]) => kv.set(key, value),
        { discard: true },
      )

      const first = yield* kv.scan({ prefix, limit: 2 })
      expect(first).toEqual({
        entries: [
          { key: `${prefix}alpha`, value: { order: 1 } },
          { key: `${prefix}beta`, value: { order: 2 } },
        ],
        next: `${prefix}beta`,
      })
      expect(yield* kv.scan({ prefix, after: first.next, limit: 2 })).toEqual({
        entries: [{ key: `${prefix}éclair`, value: { order: 3 } }],
      })
      expect(yield* kv.scan({ prefix: `${prefix}%_` })).toEqual({ entries: [] })
    }),
  )

  it.effect("defaults, normalizes, and caps scan limits", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      const prefix = "scan:limits/"
      yield* Effect.forEach(
        Array.from({ length: 1001 }, (_, index) => `${prefix}${index.toString().padStart(4, "0")}`),
        (key) => kv.set(key, key),
        { discard: true },
      )

      const defaultPage = yield* kv.scan({ prefix })
      expect(defaultPage.entries).toHaveLength(100)
      expect(defaultPage.next).toBe(`${prefix}0099`)

      const cappedPage = yield* kv.scan({ prefix, limit: 10_000 })
      expect(cappedPage.entries).toHaveLength(1000)
      expect(cappedPage.next).toBe(`${prefix}0999`)

      expect((yield* kv.scan({ prefix, limit: 2.9 })).entries).toHaveLength(2)
      expect((yield* kv.scan({ prefix, limit: 0 })).entries).toHaveLength(1)
      expect((yield* kv.scan({ prefix, limit: -10 })).entries).toHaveLength(1)
      expect((yield* kv.scan({ prefix, limit: Number.NaN })).entries).toHaveLength(100)
    }),
  )

  it.effect("reports a stored value that is not valid JSON as a miss", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      const { db } = yield* Database.Service
      yield* db.run(
        `INSERT INTO kv (key, value, time_created, time_updated) VALUES ('corrupt:json', '{"a":\\&}', 0, 0)`,
      )

      expect(yield* kv.get("corrupt:json")).toBeUndefined()
      // The read does not own the row: an unreadable entry stays until a caller overwrites it.
      expect(yield* db.all("SELECT key FROM kv WHERE key = 'corrupt:json'")).toHaveLength(1)
      yield* kv.set("corrupt:json", { recovered: true })
      expect(yield* kv.get("corrupt:json")).toEqual({ recovered: true })
    }),
  )

  it.effect("skips unreadable entries while scanning", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      const { db } = yield* Database.Service
      yield* kv.set("scan:corrupt/a", { order: 1 })
      yield* db.run(
        `INSERT INTO kv (key, value, time_created, time_updated) VALUES ('scan:corrupt/b', '{oops', 0, 0)`,
      )
      yield* kv.set("scan:corrupt/c", { order: 3 })

      expect(yield* kv.scan({ prefix: "scan:corrupt/" })).toEqual({
        entries: [
          { key: "scan:corrupt/a", value: { order: 1 } },
          { key: "scan:corrupt/c", value: { order: 3 } },
        ],
      })
    }),
  )

  it.effect("preserves falsy JSON values", () =>
    Effect.gen(function* () {
      const kv = yield* KV.Service
      const { db } = yield* Database.Service
      yield* db.run(
        `INSERT INTO kv (key, value, time_created, time_updated) VALUES ('values:null', 'null', 0, 0)`,
      )
      yield* kv.set("values:false", false)
      yield* kv.set("values:zero", 0)
      yield* kv.set("values:empty", "")

      expect(yield* kv.get("values:null")).toBeNull()
      expect(yield* kv.get("values:false")).toBe(false)
      expect(yield* kv.get("values:zero")).toBe(0)
      expect(yield* kv.get("values:empty")).toBe("")
    }),
  )
})
