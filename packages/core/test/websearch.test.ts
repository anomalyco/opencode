import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { KV } from "@opencode-ai/core/kv"
import { WebSearch } from "@opencode-ai/core/websearch"
import { testEffect } from "./lib/effect"
import { TestWebSearch } from "./lib/websearch"

const it = testEffect(TestWebSearch.layer)

const register = (id: string) =>
  Effect.gen(function* () {
    const websearch = yield* WebSearch.Service
    const providerID = WebSearch.ID.make(id)
    const calls: WebSearch.ProviderInput[] = []
    const failure: { cause?: unknown } = {}
    const registration = yield* websearch.transform((editor) => {
      editor.add({
        id: providerID,
        name: id.toUpperCase(),
        execute: (input) =>
          Effect.gen(function* () {
            calls.push(input)
            if (failure.cause !== undefined) return yield* Effect.fail(failure.cause)
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
    return { providerID, calls, failure, dispose: registration.dispose }
  })

describe("WebSearch", () => {
  it.effect("shares the normal and test interfaces without installing live providers", () =>
    Effect.gen(function* () {
      const websearch = yield* WebSearch.Service
      const test = yield* TestWebSearch.Service

      expect(websearch).toBe(test)
      expect(yield* websearch.providers()).toEqual([])
      expect(test.queries).toEqual([])
      expect((yield* websearch.query({ query: "unconfigured" }).pipe(Effect.flip))._tag).toBe(
        "WebSearch.ProviderRequired",
      )
      yield* test.wait(1)
      expect(test.queries).toEqual([{ query: "unconfigured" }])
    }),
  )

  it.effect("executes an explicit provider without changing the default", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      const test = yield* TestWebSearch.Service

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
      expect(test.queries).toEqual([{ query: "effect", providerID: parallel.providerID }, { query: "default" }])
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
      yield* websearch.transform((editor) => editor.default.set(parallel.providerID))

      expect((yield* websearch.query({ query: "configured" })).providerID).toBe(parallel.providerID)
    }),
  )

  it.effect("reloads active transforms from their current source", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      const source = { providerID: exa.providerID }
      yield* websearch.transform((editor) => editor.default.set(source.providerID))

      expect((yield* websearch.default())?.id).toBe(exa.providerID)
      source.providerID = parallel.providerID
      yield* websearch.reload()
      expect((yield* websearch.default())?.id).toBe(parallel.providerID)
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
      yield* websearch.transform((editor) => editor.default.set(exa.providerID))

      expect((yield* websearch.query({ query: "configured" })).providerID).toBe(exa.providerID)
    }),
  )

  it.effect("keeps the random provider across queries, default lookups, and reloads", () =>
    Effect.gen(function* () {
      yield* register("exa")
      yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((editor) => editor.default.set("random"))

      const first = yield* websearch.query({ query: "first" })
      expect(["exa", "parallel"]).toContain(first.providerID)
      expect((yield* websearch.default())?.id).toBe(first.providerID)
      yield* websearch.reload()
      const results = yield* Effect.all(
        Array.from({ length: 10 }, () => websearch.query({ query: "next" })),
        { concurrency: "unbounded" },
      )
      expect(results.every((result) => result.providerID === first.providerID)).toBe(true)
    }),
  )

  it.effect("preserves persisted random selection and keeps its provider", () =>
    Effect.gen(function* () {
      yield* register("exa")
      yield* register("parallel")
      const websearch = yield* WebSearch.Service
      const kv = yield* KV.Service
      yield* kv.set(WebSearch.ProviderKey, "random")
      const first = yield* websearch.query({ query: "legacy" })
      expect((yield* websearch.query({ query: "sticky" })).providerID).toBe(first.providerID)
      yield* websearch.select("random")
      expect(yield* kv.get(WebSearch.ProviderKey)).toBe("random")
      expect((yield* websearch.query({ query: "canonical" })).providerID).toBe(first.providerID)
    }),
  )
  it.effect("fails over on rate limits with random and keeps the replacement after cooldown", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((editor) => editor.default.set("random"))
      const first = yield* websearch.query({ query: "first" })
      const limited = first.providerID === exa.providerID ? exa : parallel
      const replacement = first.providerID === exa.providerID ? parallel : exa
      limited.failure.cause = TestWebSearch.httpError()
      const progress: WebSearch.ID[] = []
      expect(
        (yield* websearch.query(
          { query: "retry" },
          {
            onProvider: (provider) =>
              Effect.sync(() => {
                progress.push(provider.id)
              }),
          },
        )).providerID,
      ).toBe(replacement.providerID)
      expect(progress).toEqual([limited.providerID, replacement.providerID])
      expect(limited.calls.at(-1)).toEqual({ query: "retry" })
      expect(replacement.calls).toEqual([{ query: "retry" }])

      limited.failure.cause = undefined
      yield* TestClock.adjust("59 seconds")
      expect((yield* websearch.query({ query: "cooling" })).providerID).toBe(replacement.providerID)
      expect(limited.calls).toHaveLength(2)
      yield* TestClock.adjust("1 second")
      expect((yield* websearch.query({ query: "still sticky" })).providerID).toBe(replacement.providerID)
      replacement.failure.cause = TestWebSearch.httpError()
      expect((yield* websearch.query({ query: "recovered" })).providerID).toBe(limited.providerID)
    }),
  )

  it.effect("reselects when a concurrent query cools down the provider while progress is pending", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.select("random")
      const first = yield* websearch.default()
      if (!first) return yield* Effect.die("Expected an automatic provider")
      const limited = first.id === exa.providerID ? exa : parallel
      const replacement = first.id === exa.providerID ? parallel : exa
      const paused = yield* Deferred.make<void>()
      const resume = yield* Deferred.make<void>()
      const progress: WebSearch.ID[] = []
      const pending = yield* websearch
        .query(
          { query: "pending" },
          {
            onProvider: (provider) =>
              Effect.gen(function* () {
                progress.push(provider.id)
                if (provider.id !== first.id) return
                yield* Deferred.succeed(paused, undefined)
                yield* Deferred.await(resume)
              }),
          },
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(paused)
      limited.failure.cause = TestWebSearch.httpError()
      expect((yield* websearch.query({ query: "trigger" })).providerID).toBe(replacement.providerID)
      yield* Deferred.succeed(resume, undefined)
      expect((yield* Fiber.join(pending)).providerID).toBe(replacement.providerID)
      expect(progress).toEqual([limited.providerID, replacement.providerID])
      expect(limited.calls).toEqual([{ query: "trigger" }])
      expect(replacement.calls).toEqual([{ query: "trigger" }, { query: "pending" }])
    }),
  )

  it.effect("fails promptly when all providers are cooling down without asking for a provider", () =>
    Effect.gen(function* () {
      const providers = [yield* register("exa"), yield* register("parallel"), yield* register("tavily")]
      const websearch = yield* WebSearch.Service
      yield* websearch.select("random")
      providers.forEach((provider) => {
        provider.failure.cause = TestWebSearch.httpError()
      })
      expect(yield* websearch.query({ query: "limited" }).pipe(Effect.flip)).toBeInstanceOf(WebSearch.RequestError)
      expect(providers.map((provider) => provider.calls.length)).toEqual([1, 1, 1])
      expect(yield* websearch.default()).toBeDefined()
      expect(yield* websearch.query({ query: "still limited" }).pipe(Effect.flip)).toBeInstanceOf(
        WebSearch.RequestError,
      )
      expect(providers.map((provider) => provider.calls.length)).toEqual([1, 1, 1])
    }),
  )

  it.effect("tries each provider only once per query even with a zero cooldown", () =>
    Effect.gen(function* () {
      const providers = [yield* register("exa"), yield* register("parallel")]
      const websearch = yield* WebSearch.Service
      yield* websearch.select("random")
      providers.forEach((provider) => {
        provider.failure.cause = TestWebSearch.httpError(429, "0")
      })
      expect(yield* websearch.query({ query: "limited" }).pipe(Effect.flip)).toBeInstanceOf(WebSearch.RequestError)
      expect(providers.map((provider) => provider.calls.length)).toEqual([1, 1])
    }),
  )
  ;[
    { header: "120", millis: 120_000 },
    { header: "Thu, 01 Jan 1970 00:02:00 GMT", millis: 120_000 },
    { header: undefined, millis: 60_000 },
    { header: "invalid", millis: 60_000 },
    { header: "", millis: 60_000 },
    { header: "-1", millis: 60_000 },
  ].forEach(({ header, millis }) => {
    it.effect(`respects Retry-After ${JSON.stringify(header)} and recovers after cooldown`, () =>
      Effect.gen(function* () {
        const provider = yield* register("exa")
        const websearch = yield* WebSearch.Service
        yield* websearch.select("random")
        provider.failure.cause = TestWebSearch.httpError(429, header)
        expect(yield* websearch.query({ query: "limited" }).pipe(Effect.flip)).toBeInstanceOf(WebSearch.RequestError)
        provider.failure.cause = undefined
        yield* TestClock.adjust(millis - 1)
        expect(yield* websearch.query({ query: "early" }).pipe(Effect.flip)).toBeInstanceOf(WebSearch.RequestError)
        expect(provider.calls).toHaveLength(1)
        yield* TestClock.adjust(1)
        expect((yield* websearch.query({ query: "recovered" })).providerID).toBe(provider.providerID)
        expect(provider.calls).toHaveLength(2)
      }),
    )
  })

  it.effect("does not rotate or cool down providers for other failures", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      yield* websearch.select("random")
      const first = yield* websearch.query({ query: "first" })
      const provider = first.providerID === exa.providerID ? exa : parallel
      yield* Effect.forEach(
        [TestWebSearch.httpError(401), TestWebSearch.httpError(500), new Error("timeout")],
        (cause) =>
          Effect.gen(function* () {
            provider.failure.cause = cause
            expect(yield* websearch.query({ query: "failure" }).pipe(Effect.flip)).toMatchObject({
              providerID: first.providerID,
              cause,
            })
            expect((yield* websearch.default())?.id).toBe(first.providerID)
          }),
      )
      provider.failure.cause = undefined
      expect((yield* websearch.query({ query: "recovered" })).providerID).toBe(first.providerID)
      expect((first.providerID === exa.providerID ? parallel : exa).calls).toEqual([])
    }),
  )

  it.effect("does not fail over fixed or explicitly requested providers", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const parallel = yield* register("parallel")
      const websearch = yield* WebSearch.Service
      exa.failure.cause = TestWebSearch.httpError()
      yield* websearch.select(exa.providerID)
      expect(yield* websearch.query({ query: "fixed" }).pipe(Effect.flip)).toMatchObject({ providerID: exa.providerID })
      yield* websearch.select("random")
      expect(yield* websearch.query({ query: "explicit", providerID: exa.providerID }).pipe(Effect.flip)).toMatchObject(
        {
          providerID: exa.providerID,
        },
      )
      expect(exa.calls).toHaveLength(2)
      expect(parallel.calls).toEqual([])
    }),
  )

  it.effect("reselects when the active provider is removed", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const websearch = yield* WebSearch.Service
      yield* websearch.select("random")
      expect((yield* websearch.query({ query: "first" })).providerID).toBe(exa.providerID)
      const parallel = yield* register("parallel")
      expect((yield* websearch.query({ query: "still sticky" })).providerID).toBe(exa.providerID)
      yield* exa.dispose
      expect((yield* websearch.query({ query: "removed" })).providerID).toBe(parallel.providerID)
    }),
  )

  it.effect("uses updated registrations for the sticky provider", () =>
    Effect.gen(function* () {
      const exa = yield* register("exa")
      const websearch = yield* WebSearch.Service
      yield* websearch.select("random")
      expect((yield* websearch.query({ query: "original" })).results).toHaveLength(1)
      const updated = yield* websearch.transform((editor) =>
        editor.add({
          id: exa.providerID,
          name: "Updated Exa",
          execute: () => Effect.succeed([]),
        }),
      )
      expect(yield* websearch.default()).toEqual({ id: exa.providerID, name: "Updated Exa" })
      expect((yield* websearch.query({ query: "updated" })).results).toEqual([])
      yield* updated.dispose
      expect((yield* websearch.query({ query: "restored" })).results).toHaveLength(1)
      expect(exa.calls).toEqual([{ query: "original" }, { query: "restored" }])
    }),
  )

  it.effect("fails when web search is explicitly disabled", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((editor) => editor.default.set(false))

      expect((yield* websearch.query({ query: "disabled" }).pipe(Effect.flip))._tag).toBe("WebSearch.Disabled")
    }),
  )

  it.effect("falls back when the configured default is unavailable", () =>
    Effect.gen(function* () {
      yield* register("exa")
      const websearch = yield* WebSearch.Service
      yield* websearch.transform((editor) => editor.default.set(WebSearch.ID.make("missing")))

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
