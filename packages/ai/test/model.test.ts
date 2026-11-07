import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, Model } from "../src/effect.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { OpenAI, ZAI } from "../src/providers.js"
import { Auth, LLMClient, Route } from "../src/route.js"
import { compileRequest } from "../src/testing.js"
import { it } from "./lib/effect.js"
import { dynamicResponse, observe, type Call } from "./lib/http.js"
import { deltaChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"

const send = (model: Model<"chat">) =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    yield* LLMClient.generate(ai.request({ model, prompt: "Hi" })).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          observe(calls, input).pipe(
            Effect.as(
              input.respond(sseEvents(deltaChunk({}, "stop")), { headers: { "content-type": "text/event-stream" } }),
            ),
          ),
        ),
      ),
      // Only the outgoing request matters here.
      Effect.exit,
    )
    return calls[0]!
  })

describe("Model", () => {
  it.effect("runs a hand-described model on the package's implementation of its API", () =>
    Effect.gen(function* () {
      const local = Model.make({
        type: "chat",
        id: "qwen3-coder",
        provider: "lmstudio",
        api: "chat-completions",
        baseURL: "https://local.test/v1",
        auth: Auth.bearer("fixture"),
      })
      const call = yield* send(local)

      expect(call.url).toBe("https://local.test/v1/chat/completions")
      expect(call.headers.get("authorization")).toBe("Bearer fixture")
      expect((yield* compileRequest(ai.request({ model: local, prompt: "Hi" }))).body).toEqual(
        (yield* compileRequest(
          ai.request({
            model: Route.model(
              OpenAIChat.route.with({ endpoint: { baseURL: "https://local.test/v1" }, auth: Auth.bearer("fixture") }),
              { id: "qwen3-coder", provider: "lmstudio" },
            ),
            prompt: "Hi",
          }),
        )).body,
      )
    }),
  )

  it.effect("starts a hand-described model's options from its API's defaults", () =>
    Effect.gen(function* () {
      const model = Model.make({ type: "chat", id: "gpt-5.5", provider: "proxy", api: "responses" })
      const call = yield* send({ ...model, baseURL: "https://proxy.test/v1", auth: Auth.bearer("fixture") })

      expect(call.url).toBe("https://proxy.test/v1/responses")
      expect(JSON.parse(call.body).store).toBe(false)
    }),
  )

  it.effect("fills OpenCode's defaults and leaves host capability flags unset", () =>
    Effect.gen(function* () {
      const model = Model.make({
        type: "chat",
        id: "custom",
        provider: "custom",
        api: "chat-completions",
        capabilities: { tools: { strict: false } },
      })

      expect(model.capabilities).toEqual({ tools: { supported: true, strict: false } })
      expect(model.modalities).toEqual({ input: ["text", "image"], output: ["text"] })
      expect(model.limit).toEqual({ context: 200_000, output: 32_000 })
      expect(model.baseURL).toBeUndefined()
    }),
  )

  it.effect("fills baseURL and auth from a provider's implementation", () =>
    Effect.gen(function* () {
      const model = OpenAI.configure({ apiKey: "fixture" }).chat("gpt-5.5")

      expect(model.api).toBe("chat-completions")
      expect(model.baseURL).toBe("https://api.openai.com/v1")
      expect(model.auth).toBe(Route.of(model)?.auth)
    }),
  )

  it.effect("sends a spread-edited baseURL to the new host and keeps auth", () =>
    Effect.gen(function* () {
      const model = OpenAI.configure({ apiKey: "fixture" }).chat("gpt-5.5")
      const call = yield* send({ ...model, baseURL: "https://proxy.test/v1" })

      expect(call.url).toBe("https://proxy.test/v1/chat/completions")
      expect(call.headers.get("authorization")).toBe("Bearer fixture")
    }),
  )

  it.effect("sends a spread-edited path and auth", () =>
    Effect.gen(function* () {
      const model = OpenAI.configure({ apiKey: "fixture" }).chat("gpt-5.5")
      const call = yield* send({ ...model, path: "/v2/chat", auth: Auth.bearer("other") })

      expect(call.url).toBe("https://api.openai.com/v1/v2/chat")
      expect(call.headers.get("authorization")).toBe("Bearer other")
    }),
  )

  it.effect("applies spread-edited options and keeps the API's preset", () =>
    Effect.gen(function* () {
      const model = OpenAI.configure({ apiKey: "fixture" }).responses("gpt-5.5")
      const call = yield* send({ ...model, options: { ...model.options, temperature: 0, maxTokens: 64 } })
      const body = JSON.parse(call.body)

      expect(body.temperature).toBe(0)
      expect(body.max_output_tokens).toBe(64)
      expect(body.store).toBe(false)
    }),
  )

  it.effect("keeps a provider's dialect through spreads until api changes", () =>
    Effect.gen(function* () {
      const zai = ZAI.configure({ apiKey: "fixture" }).chat("glm-5.2")
      const edited = { ...zai, options: { ...zai.options, temperature: 0 } }
      const switched = { ...zai, api: "messages" }

      expect(zai.api).toBe("chat-completions")
      expect(Route.of(edited)?.id).toBe(Route.of(zai)?.id)
      expect((yield* compileRequest(ai.request({ model: edited, prompt: "Hi" }))).protocol).toBe("zai-chat")
      expect(Route.of(switched)).toBeUndefined()
      expect((yield* compileRequest(ai.request({ model: switched, prompt: "Hi" }))).protocol).toBe("anthropic-messages")
    }),
  )

  it.effect("fails a request for an API the package doesn't implement", () =>
    Effect.gen(function* () {
      const model = Model.make({ type: "chat", id: "custom", provider: "custom", api: "realtime" })
      const error = yield* compileRequest(ai.request({ model, prompt: "Hi" })).pipe(Effect.flip)

      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain('"realtime"')
    }),
  )
})
