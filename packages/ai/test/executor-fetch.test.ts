import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { RequestExecutor, HttpTransport, Framing, type HttpMiddleware } from "../src/route.js"
import { LLM, LLMClient, Media } from "../src/index.js"
import { OpenAI } from "../src/providers.js"
import { it } from "./lib/effect.js"

const modelRequest = LLM.request({
  model: OpenAI.configure({ apiKey: "test", baseURL: "https://provider.test" }).responses("fixture"),
  prompt: "hello",
})
const transport = HttpTransport.httpJson({ framing: Framing.sse })
const executeInference = (executor: RequestExecutor.Interface, middleware?: HttpMiddleware) =>
  transport.execute({ request, framing: Framing.sse, middleware }, modelRequest, { http: executor })

const request = HttpClientRequest.post("https://provider.test/inference").pipe(
  HttpClientRequest.setHeader("x-request", "request-value"),
  HttpClientRequest.bodyText("request body"),
)

const forward: HttpMiddleware = (input, handler) =>
  handler(input.pipe(HttpClientRequest.setHeader("x-middleware", "forwarded")))

// Provider middleware can supply fetch options at the terminal handler, not just at the callsite.
const configured: HttpMiddleware = (input, handler) =>
  forward(input, handler).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, {
      redirect: "error",
      credentials: "omit",
      cache: "reload",
      headers: { "x-options": "option-value" },
      timeout: 1,
    }),
  )

const options: RequestInit = {
  redirect: "error",
  credentials: "omit",
  cache: "no-store",
  headers: { "x-options": "option-value" },
  timeout: 1,
}

describe("native HTTP inference fetch options", () => {
  for (const mode of ["raw", "per-call", "shared"] as const) {
    it.effect(`disables Bun's implicit timeout and preserves ${mode} fetch options`, () =>
      Effect.gen(function* () {
        const calls: Array<{ url: string; init: RequestInit | undefined }> = []
        const fetch = Object.assign(
          (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ url: String(input), init })
            return Promise.resolve(new Response("ok"))
          },
          { preconnect: () => undefined },
        )
        yield* Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          yield* executeInference(executor, mode === "per-call" ? configured : undefined)
        }).pipe(
          Effect.provide(mode === "shared" ? RequestExecutor.middleware(configured) : RequestExecutor.fetchLayer),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          Effect.provideService(FetchHttpClient.RequestInit, options),
        )

        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe(request.url)
        expect(calls[0]?.init).toMatchObject({
          timeout: false,
          redirect: "error",
          credentials: "omit",
          cache: mode === "raw" ? "no-store" : "reload",
          method: "POST",
          body: new TextEncoder().encode("request body"),
        })
        expect(new Headers(calls[0]?.init?.headers).get("x-request")).toBe("request-value")
        expect(new Headers(calls[0]?.init?.headers).get("x-options")).toBe("option-value")
        expect(new Headers(calls[0]?.init?.headers).get("x-middleware")).toBe(mode === "raw" ? null : "forwarded")
        expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
        expect(calls[0]?.init?.signal?.aborted).toBe(false)
        expect(options.timeout).toBe(1)
      }),
    )
  }

  it.effect("only inference disables the fallback; standalone, media, compaction and non-AI fetch retain it", () =>
    Effect.gen(function* () {
      const calls: Array<RequestInit | undefined> = []
      const fetch = Object.assign(
        (_input: RequestInfo | URL, init?: RequestInit) => {
          calls.push(init)
          return Promise.resolve(
            Response.json({
              object: "response.compaction",
              output: [{ type: "compaction", encrypted_content: "fixture" }],
            }),
          )
        },
        { preconnect: () => undefined },
      )
      yield* Effect.gen(function* () {
        const executor = yield* RequestExecutor.Service
        yield* executeInference(executor)
        yield* executor.execute(request)
        yield* Media.url("https://provider.test/image.png").bytes()
        yield* LLMClient.compact(modelRequest)
        yield* executor.execute(request).pipe(Effect.provideService(FetchHttpClient.RequestInit, options))
      }).pipe(
        Effect.provide(LLMClient.layer),
        Effect.provide(RequestExecutor.fetchLayer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      yield* Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        yield* http.execute(request)
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.Fetch, fetch))

      expect(calls).toHaveLength(6)
      expect(calls[0]?.timeout).toBe(false)
      for (const index of [1, 2, 3, 5]) expect(calls[index]).not.toHaveProperty("timeout")
      expect(calls[4]?.timeout).toBe(1)
    }),
  )

  for (const middleware of [undefined, forward]) {
    it.effect(`still aborts an interrupted ${middleware === undefined ? "raw" : "middleware"} fetch`, () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<RequestInit>()
        const fetch = Object.assign(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              if (!init?.signal) throw new Error("expected request abort signal")
              init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
                once: true,
              })
              Deferred.doneUnsafe(started, Effect.succeed(init))
            }),
          { preconnect: () => undefined },
        )
        const fiber = yield* Effect.gen(function* () {
          const executor = yield* RequestExecutor.Service
          return yield* executeInference(executor, middleware)
        }).pipe(
          Effect.provide(RequestExecutor.fetchLayer),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          Effect.forkChild({ startImmediately: true }),
        )
        const init = yield* Deferred.await(started)
        expect(init.timeout).toBe(false)
        expect(init.signal?.aborted).toBe(false)
        yield* Fiber.interrupt(fiber)
        expect(init.signal?.aborted).toBe(true)
      }),
    )
  }
})
