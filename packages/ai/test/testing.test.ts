import { describe, expect } from "bun:test"
import { AIError, LanguageModel, LLM, LLMClient, LLMEvent, LLMRequest, RateLimitError } from "../src/index.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { TestLLM } from "../src/testing.js"
import { Effect, Fiber, Latch, Stream } from "effect"
import { testEffect } from "./lib/effect.js"

const request = LLM.request({
  model: LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route }),
  prompt: "Say hello",
})
const legacy = testEffect(TestLLM.layer())
const it = testEffect(TestLLM.testLayer())

describe("TestLLM legacy client", () => {
  legacy.effect("does not observe requests or consume responses until execution", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Service
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("second", "second"))

      llm.client.stream(request)
      llm.client.generate(request)
      expect(llm.requests).toEqual([])

      expect((yield* llm.client.generate(request)).text).toBe("first")
      expect((yield* llm.client.generate(request)).text).toBe("second")
      expect(llm.requests).toEqual([request, request])
    }),
  )

  legacy.effect("assigns and records a fresh response for each execution", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Service
      yield* llm.push(
        TestLLM.text("first", "first"),
        TestLLM.text("second", "second"),
        TestLLM.text("third", "third"),
        TestLLM.text("fourth", "fourth"),
      )
      const stream = llm.client.stream(request)
      const generate = llm.client.generate(request)

      expect(yield* Stream.runCollect(stream)).toEqual(TestLLM.text("first", "first"))
      expect(yield* Stream.runCollect(stream)).toEqual(TestLLM.text("second", "second"))
      expect((yield* generate).text).toBe("third")
      expect((yield* generate).text).toBe("fourth")
      expect(llm.requests).toEqual([request, request, request, request])
    }),
  )

  legacy.effect("keeps module-level controls and clientLayer on the same backing state", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Service
      const requests = llm.requests
      yield* TestLLM.push(TestLLM.text("queued", "queued"))
      yield* TestLLM.always(TestLLM.text("fallback", "fallback"))
      expect((yield* LLMClient.generate(request).pipe(Effect.provide(TestLLM.clientLayer))).text).toBe("queued")
      yield* TestLLM.wait(1)
      expect(requests).toEqual([request])
      requests.length = 0
      expect((yield* llm.client.generate(request)).text).toBe("fallback")
      expect(llm.requests).toBe(requests)
      expect(requests).toEqual([request])
    }),
  )
})

describe("TestLLM first-class client", () => {
  it.effect("provides the same object under normal and test tags with snapshot observations", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const client = yield* LLMClient.Service
      expect(client).toBe(llm)
      const before = yield* llm.requests()
      yield* llm.push(TestLLM.text("hello", "answer"))
      const generate = client.generate(request)
      client.stream(request)
      expect(yield* llm.requests()).toEqual([])

      expect((yield* generate).text).toBe("hello")
      expect(before).toEqual([])
      expect(yield* llm.requests()).toEqual([request])
      expect(yield* llm.requests()).not.toBe(yield* llm.requests())
    }),
  )

  it.effect("prioritizes queued replies over request-dependent and constant fallbacks", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const served: LLMRequest[] = []
      yield* llm.always(TestLLM.text("old fallback", "old"))
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("second", "second"))
      yield* llm.serve((request) => {
        served.push(request)
        return TestLLM.text(request.promptCacheKey ?? "default", "served")
      })

      expect((yield* LLMClient.generate(request)).text).toBe("first")
      expect((yield* LLMClient.generate(request)).text).toBe("second")
      expect(served).toEqual([])
      const selected = LLMRequest.update(request, { promptCacheKey: "selected" })
      expect((yield* LLMClient.generate(selected)).text).toBe("selected")
      expect((yield* LLMClient.generate(request)).text).toBe("default")
      expect(served).toEqual([selected, request])

      yield* llm.push(TestLLM.text("queued again", "queued"))
      yield* llm.always(TestLLM.text("constant", "constant"))
      expect((yield* LLMClient.generate(request)).text).toBe("queued again")
      expect((yield* LLMClient.generate(request)).text).toBe("constant")
      expect((yield* LLMClient.generate(request)).text).toBe("constant")
      expect(served).toEqual([selected, request])
    }),
  )

  testEffect(
    TestLLM.testLayer({
      transformRequest: (request) => LLMRequest.update(request, { promptCacheKey: "observation" }),
    }),
  ).effect("transforms observations without changing the request passed to the responder", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      yield* llm.serve((input) => {
        expect(input).toBe(request)
        return TestLLM.text("original", "answer")
      })
      const generate = llm.generate(request)
      expect(yield* llm.requests()).toEqual([])
      expect((yield* generate).text).toBe("original")
      expect(yield* llm.requests()).toEqual([LLMRequest.update(request, { promptCacheKey: "observation" })])
    }),
  )

  it.effect("broadcasts request-arrival waits and satisfies waits registered afterward", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      yield* llm.always(TestLLM.stop())
      const first = yield* llm.wait(2).pipe(Effect.forkChild({ startImmediately: true }))
      const second = yield* llm.wait(2).pipe(Effect.forkChild({ startImmediately: true }))
      yield* llm.generate(request)
      expect(first.pollUnsafe()).toBeUndefined()
      expect(second.pollUnsafe()).toBeUndefined()
      yield* llm.generate(request)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      yield* llm.wait(2)
      expect(yield* llm.requests()).toHaveLength(2)
    }),
  )
  ;(["queued", "served"] as const).forEach((mode) => {
    it.effect(`assigns ${mode} replies before resuming request-arrival continuations`, () =>
      Effect.gen(function* () {
        const llm = yield* TestLLM.Test
        const responses = [TestLLM.text("first", "first"), TestLLM.text("second", "second")]
        yield* mode === "queued" ? llm.push(...responses) : llm.serve(() => responses.shift() ?? [])
        const later = yield* llm
          .wait(1)
          .pipe(Effect.andThen(llm.generate(request)), Effect.forkChild({ startImmediately: true }))

        expect((yield* llm.generate(request)).text).toBe("first")
        expect((yield* Fiber.join(later)).text).toBe("second")
        expect(yield* llm.requests()).toEqual([request, request])
      }),
    )
  })

  it.effect("notifies arrival waiters even when the responder defects", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const defect = new Error("Broken fixture responder")
      yield* llm.serve(() => {
        throw defect
      })
      const waiter = yield* llm.wait(1).pipe(Effect.forkChild({ startImmediately: true }))
      expect(yield* llm.generate(request).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
      yield* Fiber.join(waiter)
    }),
  )

  it.effect("builds independent state even when the same layer is provided concurrently", () => {
    const layer = TestLLM.testLayer()
    const run = Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      expect(yield* llm.requests()).toEqual([])
      yield* llm.push(TestLLM.text("one", "answer"))
      expect((yield* LLMClient.generate(request)).text).toBe("one")
      return yield* llm.requests()
    }).pipe(Effect.provide(layer))
    return Effect.gen(function* () {
      expect(yield* Effect.all([run, run], { concurrency: "unbounded" })).toEqual([[request], [request]])
    })
  })

  it.effect("counts concurrent starts on one gate without serializing their response assignment", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("second", "second"))
      const generate = llm.generate(request)
      const gate = yield* llm.gate()
      const first = yield* generate.pipe(Effect.forkChild({ startImmediately: true }))
      yield* gate.started
      const second = yield* generate.pipe(Effect.forkChild({ startImmediately: true }))
      yield* gate.started
      yield* llm.wait(2)
      expect(first.pollUnsafe()).toBeUndefined()
      expect(second.pollUnsafe()).toBeUndefined()
      yield* gate.release
      expect((yield* Fiber.join(first)).text).toBe("first")
      expect((yield* Fiber.join(second)).text).toBe("second")
    }),
  )

  it.effect("does not clear a replacement gate when the previous gate is released", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      yield* llm.always(TestLLM.stop())
      const previous = yield* llm.gate()
      const first = yield* llm.generate(request).pipe(Effect.forkChild({ startImmediately: true }))
      yield* previous.started
      const next = yield* llm.gate()
      yield* previous.release
      yield* Fiber.join(first)

      const second = yield* llm.generate(request).pipe(Effect.forkChild({ startImmediately: true }))
      yield* next.started
      expect(second.pollUnsafe()).toBeUndefined()
      yield* next.release
      yield* Fiber.join(second)
    }),
  )

  it.effect("releases a gate when its deliberately narrower scope closes", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      yield* llm.always(TestLLM.stop())
      // Only the gate is scoped here; its release must happen before the test ends.
      const run = yield* Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* llm.gate()
          const run = yield* llm.generate(request).pipe(Effect.forkChild({ startImmediately: true }))
          yield* gate.started
          return run
        }),
      )
      yield* Fiber.join(run)
      yield* llm.generate(request)
      expect(yield* llm.requests()).toHaveLength(2)
    }),
  )

  it.effect("keeps an executed response consumed after interruption and permits later requests", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      yield* llm.push(TestLLM.text("interrupted", "first"), TestLLM.text("next", "second"))
      const gate = yield* llm.gate()
      const run = yield* llm.generate(request).pipe(Effect.forkChild({ startImmediately: true }))
      yield* gate.started
      yield* Fiber.interrupt(run)
      yield* gate.release
      expect((yield* llm.generate(request)).text).toBe("next")
      expect(yield* llm.requests()).toHaveLength(2)
    }),
  )

  it.effect("consumes a supplied stream's post-finish tail and runs its finalizer", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const tail = yield* Latch.make()
      const release = yield* Latch.make()
      const finalized = yield* Latch.make()
      yield* llm.push(
        Stream.unwrap(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => finalized.open)
            return Stream.fromIterable(TestLLM.text("complete", "answer")).pipe(
              Stream.concat(Stream.fromEffect(tail.open.pipe(Effect.andThen(release.await))).pipe(Stream.drain)),
            )
          }),
        ),
      )
      const run = yield* llm.generate(request).pipe(Effect.forkChild({ startImmediately: true }))
      yield* tail.await
      expect(run.pollUnsafe()).toBeUndefined()
      yield* release.open
      expect((yield* Fiber.join(run)).text).toBe("complete")
      yield* finalized.await
    }),
  )

  it.effect("preserves irregular events, ordinary EOF, typed failures, and responder defects", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const events = [LLMEvent.textDelta({ id: "without-start", text: "partial" })]
      yield* llm.push(events, [])
      expect(yield* Stream.runCollect(llm.stream(request))).toEqual(events)
      expect(yield* Stream.runCollect(llm.stream(request))).toEqual([])

      const failure = new AIError({ reason: new RateLimitError({ message: "Try later" }) })
      const observed: LLMEvent[] = []
      yield* llm.serve(() => TestLLM.failAfter(failure, ...events))
      expect(
        yield* llm.stream(request).pipe(
          Stream.runForEach((event) => Effect.sync(() => observed.push(event))),
          Effect.flip,
        ),
      ).toBe(failure)
      expect(observed).toEqual(events)
      expect(yield* llm.generate(request).pipe(Effect.flip)).toBe(failure)

      const defect = new Error("Broken fixture responder")
      yield* llm.serve(() => {
        throw defect
      })
      expect(yield* llm.generate(request).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
      yield* llm.push(TestLLM.text("recovered", "answer"))
      expect((yield* llm.generate(request)).text).toBe("recovered")
    }),
  )

  it.effect("defects on unexpected requests instead of waiting for a late script", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const defect = yield* llm.generate(request).pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(Error)
      if (!(defect instanceof Error)) return
      expect(defect.message).toBe("TestLLM has no response for request 1")
      expect(yield* llm.requests()).toEqual([request])
      yield* llm.push(TestLLM.stop())
      yield* llm.generate(request)
    }),
  )
})
