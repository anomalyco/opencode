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
      expect(yield* kv.get("wellknown:sources")).toBeUndefined()
    }),
  )
})
