import { expect } from "bun:test"
import {
  AIError,
  AuthenticationError,
  InvalidRequestError,
  LanguageModel,
  LLMClient,
  LLMEvent,
  ProviderInternalError,
  QuotaExceededError,
  RateLimitError,
  TransportError,
} from "@opencode/ai/effect"
import { RequestExecutor } from "@opencode/ai/route"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { AISDK } from "@opencode/core/aisdk"
import { Generate } from "@opencode/core/generate"
import { Integration } from "@opencode/core/integration"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ID, Info, Model, Ref } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Npm } from "@opencode/util/npm"
import { Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/http"
import { testEffect } from "./lib/effect"

const selected = Info.make({
  ...Info.default(Provider.ID.make("test-provider"), ID.make("gemini")),
  package: Provider.aisdk("@ai-sdk/perplexity"),
})
const runtime = LanguageModel.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })
const reference = Ref.make({ providerID: selected.providerID, id: selected.id })

const providers = Layer.mock(Provider.Service, {
  get: () => Effect.undefined,
})
const models = Layer.mock(Model.Service, {
  get: () => Effect.succeed(selected),
})
const integrations = Layer.mock(Integration.Service, {
  revision: () => 0,
  connection: {
    active: () => Effect.undefined,
    resolve: () => Effect.die("unused"),
    key: () => Effect.die("unused"),
    external: () => Effect.die("unused"),
    activate: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
  },
  oauth: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    complete: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
  command: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})
const npm = Layer.mock(Npm.Service, {
  add: () => Effect.die("unused"),
  which: () => Effect.die("unused"),
})
const aisdk = Layer.mock(AISDK.Service, {
  hook: {
    sdk: () => Effect.die("unused"),
    language: () => Effect.die("unused"),
  },
  model: () => Effect.succeed(runtime),
})
const client = TestLLM.testLayer({ fallback: TestLLM.text("OK", "generate") })

const resolver = ModelResolver.layer.pipe(Layer.provide(Layer.mergeAll(providers, models, integrations, npm, aisdk)))
const it = testEffect(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, client))))
const resolverIt = testEffect(resolver)
const retryIt = testEffect(Generate.layer.pipe(Layer.provideMerge(Layer.merge(resolver, TestLLM.testLayer()))))

it.effect("loads dynamic AI SDK models", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const result = yield* generate.text({
      prompt: "Return exactly OK",
      model: Ref.make({ providerID: selected.providerID, id: selected.id }),
    })

    expect(result).toBe("OK")
  }),
)

for (const operation of ["request", "read"] as const) {
  retryIt.effect(`regenerates the full stateless response after a ${operation} failure`, () =>
    Effect.gen(function* () {
      const generate = yield* Generate.Service
      const llm = yield* TestLLM.Test
      yield* llm.push(
        TestLLM.failAfter(
          new AIError({ reason: new TransportError({ message: "Disconnected", transport: "http", operation }) }),
          ...(operation === "read"
            ? [LLMEvent.textStart({ id: "failed" }), LLMEvent.textDelta({ id: "failed", text: "Discard this" })]
            : []),
        ),
        TestLLM.text("Fresh answer", "success"),
      )
      const result = yield* generate
        .text({ prompt: "Answer privately", model: reference })
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* llm.wait(1)
      yield* TestClock.adjust("3 seconds")
      expect(yield* Fiber.join(result)).toBe("Fresh answer")
      const requests = yield* llm.requests()
      expect(requests).toHaveLength(2)
      expect(requests[1]).toBe(requests[0])
    }),
  )
}

for (const reason of [
  new AuthenticationError({ message: "Invalid credentials" }),
  new QuotaExceededError({ message: "No quota" }),
  new InvalidRequestError({ message: "Invalid prompt" }),
]) {
  retryIt.effect(`does not retry stateless ${reason._tag} failures`, () =>
    Effect.gen(function* () {
      const generate = yield* Generate.Service
      const llm = yield* TestLLM.Test
      yield* llm.push(TestLLM.failAfter(new AIError({ reason })))
      const result = yield* generate.text({ prompt: "Answer privately", model: reference }).pipe(Effect.flip)
      expect(result).toBeInstanceOf(Generate.UnavailableError)
      expect(result.message).toBe(reason.message)
      expect(yield* llm.requests()).toHaveLength(1)
    }),
  )
}

retryIt.effect("honors provider backoff and cancels without another generation", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const llm = yield* TestLLM.Test
    yield* llm.always(
      TestLLM.failAfter(new AIError({ reason: new RateLimitError({ message: "Wait", retryAfterMs: 5_000 }) })),
    )
    const result = yield* generate
      .text({ prompt: "Answer privately", model: reference })
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* llm.wait(1)
    yield* TestClock.adjust("4999 millis")
    expect(yield* llm.requests()).toHaveLength(1)
    yield* Fiber.interrupt(result)
    yield* TestClock.adjust("1 minute")
    expect(Exit.hasInterrupts(yield* Fiber.await(result))).toBe(true)
    expect(yield* llm.requests()).toHaveLength(1)
  }),
)

for (const [reason, attempts] of [
  [new ProviderInternalError({ message: "Unavailable" }), 11],
  [new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }), 4],
] as const) {
  retryIt.effect(`bounds stateless ${reason._tag} retries`, () =>
    Effect.gen(function* () {
      const generate = yield* Generate.Service
      const llm = yield* TestLLM.Test
      yield* llm.always(TestLLM.failAfter(new AIError({ reason })))
      const result = yield* generate
        .text({ prompt: "Answer privately", model: reference })
        .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }))
      yield* llm.wait(1)
      yield* TestClock.adjust("2 minutes")
      expect(yield* Fiber.join(result)).toBeInstanceOf(Generate.UnavailableError)
      expect(yield* llm.requests()).toHaveLength(attempts)
    }),
  )
}

resolverIt.effect("resolves dynamic models with their catalog metadata", () =>
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const result = yield* resolver.resolve(Ref.make({ providerID: selected.providerID, id: selected.id }))

    expect(result).toEqual({
      model: runtime,
      ref: Ref.make({ providerID: selected.providerID, id: selected.id }),
      capabilities: selected.capabilities,
      cost: selected.cost,
      limit: selected.limit,
    })
  }),
)

testEffect(Layer.empty).effect("attributes each stateless completion without creating a stored session", () =>
  Effect.gen(function* () {
    const sessions: string[] = []
    const http = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          const session = request.headers["x-opencode-session"]
          if (!session)
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                {
                  error: { type: "MissingSessionID", message: "Session ID is required" },
                },
                { status: 400 },
              ),
            )
          sessions.push(session)
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              `data: ${JSON.stringify({
                id: "completion",
                object: "chat.completion.chunk",
                created: 1,
                model: "gemini",
                choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }],
              })}\n\ndata: [DONE]\n\n`,
              { headers: { "content-type": "text/event-stream" } },
            ),
          )
        }),
      ),
    )
    const native = LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(http))))
    yield* Effect.gen(function* () {
      const generate = yield* Generate.Service
      for (let index = 0; index < 2; index++) {
        expect(
          yield* generate.text({
            prompt: "Return exactly OK",
            model: Ref.make({ providerID: selected.providerID, id: selected.id }),
          }),
        ).toBe("OK")
      }
    }).pipe(Effect.provide(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, native)))))
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toStartWith("ses_")
    expect(sessions[1]).not.toBe(sessions[0])
  }),
)
