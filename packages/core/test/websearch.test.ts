import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { KV } from "@opencode-ai/core/kv"
import { WebSearch } from "@opencode-ai/core/websearch"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([WebSearch.node, Bus.node, KV.node])))

const register = (id: string) =>
  Effect.gen(function* () {
    const websearch = yield* WebSearch.Service
    const providerID = WebSearch.ID.make(id)
    const calls: WebSearch.ProviderInput[] = []
    yield* websearch.transform((draft) => {
      draft.add({
        id: providerID,
        name: id.toUpperCase(),
        execute: (input) =>
          Effect.sync(() => {
            calls.push(input)
            return [
              {
                url: `https://${id}.example.com`,
                title: input.query,
                content: `${id}: ${input.query}`,
                time: {},
              },
            ]
          }),
      })
    })
    return { providerID, calls }
  })

describe("WebSearch", () => {
  it.effect("executes an explicit provider without changing the default", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service

      expect(yield* websearch.query({ query: "effect", providerID: parallel.providerID })).toEqual(
        new WebSearch.Response({
          providerID: parallel.providerID,
          results: [
            {
              url: "https://parallel.example.com",
              title: "effect",
              content: "parallel: effect",
              time: {},
            },
          ],
        }),
      )
      expect((yield* websearch.query({ query: "default" }).pipe(Effect.flip))._tag).toBe("WebSearch.ProviderRequired")
      expect(parallel.calls).toEqual([{ query: "effect" }])
    }),
  )

  it.effect("requires a provider when no default is set", () =>
    Effect.gen(function* () {
      yield* register("exa")
      yield* register("parallel")
      const websearch = yield* WebSearch.Service

      expect((yield* websearch.query({ query: "layers" }).pipe(Effect.flip))._tag).toBe("WebSearch.ProviderRequired")
    }),
  )

  it.effect("uses the default set by a transform", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((draft) => draft.default.set(parallel.providerID))

      expect((yield* websearch.query({ query: "configured" })).providerID).toBe(parallel.providerID)
    }),
  )

  it.effect("persists the selected provider in KV", () =>
    Effect.gen(function* () {
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      const kv = yield* KV.Service

      yield* websearch.select(parallel.providerID)

      expect(yield* kv.get(WebSearch.ProviderKey)).toBe(parallel.providerID)
      expect((yield* websearch.query({ query: "remembered" })).providerID).toBe(parallel.providerID)
    }),
  )

  it.effect("keeps config transforms above the persisted selection", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.select(parallel.providerID)
      yield* websearch.transform((draft) => draft.default.set(exa.providerID))

      expect((yield* websearch.query({ query: "configured" })).providerID).toBe(exa.providerID)
    }),
  )

  it.effect("chooses a registered provider for random selection", () =>
    Effect.gen(function* () {
      yield* register("exa")
      yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((draft) => draft.default.set("random"))

      expect(["exa", "parallel"]).toContain((yield* websearch.query({ query: "random" })).providerID)
    }),
  )

  it.effect("fails when web search is explicitly disabled", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((draft) => draft.default.set(false))

      expect((yield* websearch.query({ query: "disabled" }).pipe(Effect.flip))._tag).toBe("WebSearch.Disabled")
    }),
  )

  it.effect("falls back when the configured default is unavailable", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((draft) => draft.default.set(WebSearch.ID.make("missing")))

      expect((yield* websearch.query({ query: "fallback" }).pipe(Effect.flip))._tag).toBe("WebSearch.ProviderRequired")
    }),
  )

  it.effect("removes scoped provider registrations", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const scope = yield* Scope.fork(yield* Scope.Scope)
      const provider = yield* register("temporary").pipe(Scope.provide(scope))
      expect(yield* websearch.providers()).toContainEqual({ id: provider.providerID, name: "TEMPORARY" })
      yield* Scope.close(scope, Exit.void)
      expect(yield* websearch.providers()).not.toContainEqual({ id: provider.providerID, name: "TEMPORARY" })
    }),
  )
})
