import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { KV } from "@opencode-ai/core/kv"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(KV.node))

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
      expect(yield* kv.scanAll(`${prefix}%_`)).toEqual([])
      expect(yield* kv.scanAll(prefix)).toEqual([...first.entries, { key: `${prefix}éclair`, value: { order: 3 } }])
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

      const all = kv.scanAll(prefix)
      const entries = Array.from({ length: 1001 }, (_, index) => {
        const key = `${prefix}${index.toString().padStart(4, "0")}`
        return { key, value: key }
      })
      expect(yield* all).toEqual(entries)
      yield* kv.remove(`${prefix}0000`)
      expect(yield* all).toEqual(entries.slice(1))
    }),
  )
})
