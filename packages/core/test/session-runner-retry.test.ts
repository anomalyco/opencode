import { describe, expect, test } from "bun:test"
import {
  ai,
  AIError,
  InvalidProviderOutputError,
  ProviderInternalError,
  RateLimitError,
  TransportError,
} from "@opencode/ai/effect"
import { configure } from "@opencode/ai/providers/openai-compatible"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { ModelRetry } from "@opencode/core/model-retry"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Clock, Duration, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { advance } from "./lib/clock"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })
const rateLimit = new AIError({ reason: new RateLimitError({ message: "rate limited" }) })
const incompleteStream = new AIError({
  reason: new InvalidProviderOutputError({
    message: "OpenAI Chat stream ended without finish_reason",
    classification: "incomplete-stream",
    route: "openai-chat",
  }),
})
const dnsFailure = new AIError({
  reason: new TransportError({
    message: "getaddrinfo ENOTFOUND opencode.ai",
    transport: "http",
    operation: "request",
    code: "ENOTFOUND",
    url: "https://opencode.ai/zen/v1/responses",
  }),
})
const refused = new AIError({
  reason: new TransportError({
    message: "Unable to connect",
    transport: "http",
    operation: "request",
    code: "ECONNREFUSED",
  }),
})

const sse = (...chunks: ReadonlyArray<unknown>) =>
  `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`

const emptyUsageSse = sse({
  id: "chatcmpl_empty",
  choices: [],
  usage: { prompt_tokens: 157_000, completion_tokens: 0, total_tokens: 157_000 },
})

const recoveredSse = sse(
  { id: "chatcmpl_ok", choices: [{ delta: { content: "Recovered" }, finish_reason: null }], usage: null },
  { id: "chatcmpl_ok", choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
)

const openAICompatibleRequest = ai.request({
  model: configure({ baseURL: "https://api.example.test/v1", apiKey: "test-key" }).model("gemini-4-neon"),
  prompt: "Hello",
})

const sseClientLayer = (bodyForAttempt: (attempt: number) => string) => {
  let attempts = 0
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(bodyForAttempt(++attempts), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
      ),
    ),
  )
  return {
    attempts: () => attempts,
    layer: LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.provide(http)),
  }
}

const input = (cause: AIError) => ({
  cause,
  error: toSessionError(cause),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
  hook: () => Effect.void,
  retry: SessionRunnerRetry.isRetryable(cause),
})

// Decisions for `count` consecutive failures of the same cause within one step.
const decisions = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
    const results: boolean[] = []
    for (let i = 0; i < count; i++) results.push((yield* policy(input(cause))).retry)
    return results
  })

describe("SessionRunnerRetry.policy", () => {
  it.effect("stops retrying transport timeouts after three attempts", () =>
    Effect.gen(function* () {
      expect(yield* decisions(timeout, 4)).toEqual([true, true, true, false])
    }),
  )

  it.effect("stops retrying incomplete streams after two retries", () =>
    Effect.gen(function* () {
      expect(yield* decisions(incompleteStream, 3)).toEqual([true, true, false])
    }),
  )

  it.effect("keeps the general allowance for other transient failures", () =>
    Effect.gen(function* () {
      expect(yield* decisions(internal, 11)).toEqual([...Array(10).fill(true), false])
      expect(yield* decisions(rateLimit, 11)).toEqual([...Array(10).fill(true), false])
    }),
  )

  it.effect("keeps retrying an unreachable host for an hour with gaps of at most 30 seconds", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      const started = yield* Clock.currentTimeMillis
      const delays: number[] = []
      while (true) {
        const decision = yield* policy(input(dnsFailure))
        if (!decision.retry) break
        delays.push(decision.delay)
        yield* TestClock.adjust(Duration.millis(decision.delay))
      }
      const waited = (yield* Clock.currentTimeMillis) - started
      expect(delays.length).toBeGreaterThan(100)
      expect(Math.max(...delays)).toBeLessThanOrEqual(30_000)
      expect(waited).toBeGreaterThanOrEqual(Duration.toMillis(ModelRetry.UNREACHABLE_WINDOW))
      expect(waited).toBeLessThanOrEqual(Duration.toMillis(ModelRetry.UNREACHABLE_WINDOW) + 30_000)
    }),
  )

  it.effect("keeps a refused connection on the general allowance", () =>
    Effect.gen(function* () {
      expect(ModelRetry.isUnreachable(refused)).toBe(false)
      expect(yield* decisions(refused, 11)).toEqual([...Array(10).fill(true), false])
    }),
  )

  it.effect("doesn't spend the general allowance on an unreachable host", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      for (let i = 0; i < 20; i++) expect((yield* policy(input(dnsFailure))).retry).toBe(true)
      const results: boolean[] = []
      for (let i = 0; i < 11; i++) results.push((yield* policy(input(internal))).retry)
      expect(results).toEqual([...Array(10).fill(true), false])
    }),
  )
})

describe("ModelRetry.retry", () => {
  it.effect("caps retries when OpenAI Chat ends with HTTP 200, usage, zero output tokens, and no finish_reason", () =>
    Effect.gen(function* () {
      const client = sseClientLayer(() => emptyUsageSse)
      const run = yield* ModelRetry.retry(LLMClient.generate(openAICompatibleRequest)).pipe(
        Effect.provide(client.layer),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* advance(() => run.pollUnsafe() !== undefined)
      const error = yield* Fiber.join(run).pipe(Effect.flip)
      expect(client.attempts()).toBe(3)
      expect(error).toMatchObject({
        reason: { _tag: "InvalidProviderOutput", classification: "incomplete-stream", route: "openai-chat" },
        message: "OpenAI Chat stream ended without finish_reason",
      })
    }),
  )

  for (const succeedOnAttempt of [2, 3]) {
    it.effect(`recovers cleanly when OpenAI Chat succeeds on attempt ${succeedOnAttempt}`, () =>
      Effect.gen(function* () {
        const client = sseClientLayer((attempt) => (attempt < succeedOnAttempt ? emptyUsageSse : recoveredSse))
        const run = yield* ModelRetry.retry(LLMClient.generate(openAICompatibleRequest)).pipe(
          Effect.provide(client.layer),
          Effect.forkChild({ startImmediately: true }),
        )
        yield* advance(() => run.pollUnsafe() !== undefined)
        const response = yield* Fiber.join(run)
        expect(client.attempts()).toBe(succeedOnAttempt)
        expect(response.text).toBe("Recovered")
      }),
    )
  }
})

describe("ModelRetry.retryOneShot", () => {
  it.effect("doesn't replay a call whose response was cut off by the network going down", () =>
    Effect.gen(function* () {
      let calls = 0
      const cutOff = new AIError({
        reason: new TransportError({
          message: "Network is down",
          transport: "http",
          operation: "read",
          code: "ENETDOWN",
        }),
      })
      yield* ModelRetry.retryOneShot(Effect.suspend(() => (calls++, Effect.fail(cutOff)))).pipe(Effect.flip)
      expect(calls).toBe(1)
    }),
  )
})

describe("toSessionError", () => {
  test("names the network when the provider's host can't be reached", () => {
    expect(toSessionError(dnsFailure)).toEqual({
      type: "provider.transport",
      message: "Can't reach opencode.ai. Check the network connection. (getaddrinfo ENOTFOUND opencode.ai)",
    })
    expect(toSessionError(refused)).toEqual({ type: "provider.transport", message: "Unable to connect" })
  })
})
