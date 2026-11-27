import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Headers } from "effect/http"
import { Capabilities } from "../src/capabilities.js"
import { LLM } from "../src/llm.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { Provider } from "../src/provider.js"
import { Auth } from "../src/route/auth.js"
import { canCompact, compileRequest } from "../src/route/client.js"
import { LLMRequest } from "../src/schema/index.js"

const compile = (model: LLMRequest["model"]) =>
  Effect.runPromise(compileRequest(LLM.request({ model, prompt: "hi", maxTokens: 10 })))

const authHeaders = (model: LLMRequest["model"]) =>
  Effect.runPromise(
    Auth.toEffect(model.route.auth)({
      request: {},
      method: "POST",
      url: "https://x.test",
      body: "",
      headers: Headers.empty,
    }),
  )

const example = Provider.make({
  id: "example",
  auth: Provider.apiKey("EXAMPLE_API_KEY"),
  apis: {
    chat: OpenAIChat.api.at("https://chat.example.test/v1", {
      capabilities: { output: { maxTokensField: "max_tokens" } },
      guess: (id) =>
        id.startsWith("big-") ? { capabilities: { reasoning: { field: "reasoning_content" } } } : undefined,
    }),
    responses: OpenAIResponses.api.at("https://responses.example.test/v1", { compact: { trigger: false } }),
  },
}).with({ apiKey: "fixture" })

describe("Provider.model", () => {
  test("uses the first API unless one is named", () => {
    expect(example.model("m").route.protocol).toBe("openai-chat")
    expect(example.model("m", { api: "responses" }).route.protocol).toBe("openai-responses")
    expect(example.model("m").route.endpoint.baseURL).toBe("https://chat.example.test/v1")
    expect(example.model("m").provider).toBe("example")
    expect(example.model("m").route.providerMetadataKey).toBe("example")
  })

  test("rejects an API the provider does not serve", () => {
    // @ts-expect-error not one of the provider's APIs
    expect(() => example.model("m", { api: "messages" })).toThrow("does not serve a messages API")
  })

  test("layers capabilities: API default, model-name guess, host facts, then the caller", () => {
    expect(example.model("small").compatibility).toMatchObject({ maxTokensField: "max_tokens" })
    expect(example.model("small").compatibility?.reasoningField).toBeUndefined()
    expect(example.model("big-1").compatibility).toMatchObject({
      maxTokensField: "max_tokens",
      reasoningField: "reasoning_content",
    })
    const passed = example.model("big-1", {
      capabilities: { output: { maxTokensField: "max_completion_tokens" }, reasoning: { field: "reasoning" } },
    })
    expect(passed.compatibility).toMatchObject({ maxTokensField: "max_completion_tokens", reasoningField: "reasoning" })
  })

  test("sends the capabilities on the wire", async () => {
    expect((await compile(example.model("m"))).body).toMatchObject({ max_tokens: 10 })
    expect(
      (await compile(example.model("m", { capabilities: { output: { maxTokensField: "max_completion_tokens" } } })))
        .body,
    ).toMatchObject({ max_completion_tokens: 10 })
  })

  test("drops compaction mechanisms the host turns off", () => {
    const model = example.model("m", { api: "responses" })
    expect(canCompact(model)).toBe(true)
    expect(canCompact(model, { mechanism: "trigger" })).toBe(false)
  })
})

describe("Provider.with", () => {
  test("replaces every API's base URL and merges headers, query and body", () => {
    const patched = example.with({ baseURL: "https://proxy.test", headers: { a: "1" }, query: { v: "1" } }).with({
      headers: { b: "2" },
      body: { extra: true },
    })
    const model = patched.model("m", { api: "responses" })
    expect(model.route.endpoint.baseURL).toBe("https://proxy.test")
    expect(model.route.endpoint.query).toEqual({ v: "1" })
    expect(model.options?.headers).toEqual({ a: "1", b: "2" })
    expect(model.options?.http?.body).toEqual({ extra: true })
  })

  test("resolves auth by kind", async () => {
    expect((await authHeaders(example.model("m"))).authorization).toBe("Bearer fixture")
    expect((await authHeaders(example.with({ apiKey: false }).model("m"))).authorization).toBeUndefined()
    const custom = example.with({ auth: Auth.headers({ "x-key": "custom" }) }).model("m")
    expect((await authHeaders(custom))["x-key"]).toBe("custom")
    const keyless = Provider.make({ id: "local", auth: Provider.keyless, apis: example.apis })
    expect(keyless.auth.kind).toBe("none")
    expect((await authHeaders(keyless.model("m"))).authorization).toBeUndefined()
  })
})

describe("Provider.entrypoint", () => {
  test("splits flat settings into connection settings, provider keys and provider options", () => {
    const provider = Provider.make({
      id: "example",
      auth: Provider.apiKey("EXAMPLE_API_KEY"),
      apis: example.apis,
      settings: { keys: ["team"], patch: (values) => ({ headers: { "x-team": String(values.team) } }) },
    })
    const model = Provider.entrypoint(provider, "responses")("m", {
      apiKey: "k",
      baseURL: "https://proxy.test",
      headers: { "x-team": "override" },
      body: { extra: true },
      team: "core",
      reasoningEffort: "high",
    })
    expect(model.route.protocol).toBe("openai-responses")
    expect(model.route.endpoint.baseURL).toBe("https://proxy.test")
    expect(model.options?.headers).toEqual({ "x-team": "override" })
    expect(model.options?.http?.body).toEqual({ extra: true })
    expect(model.options?.providerOptions).toMatchObject({ reasoningEffort: "high" })
    expect(model.options?.providerOptions).not.toHaveProperty("team")
  })
})

describe("Api.extend", () => {
  test("inherits the parent's codec rules and wraps its body builder", async () => {
    const Dialect = OpenAIResponses.api.extend({
      id: "dialect-responses",
      body: (request, base) => base(request).pipe(Effect.map((body) => ({ ...body, dialect: true }))),
    })
    expect(Dialect.protocol.toolUpdates).toBe(OpenAIResponses.api.protocol.toolUpdates)
    expect(Dialect.protocol.supportsEffortUpdates).toBe(OpenAIResponses.api.protocol.supportsEffortUpdates)
    expect(Dialect.compact).toBe(OpenAIResponses.api.compact)
    const model = Provider.make({
      id: "dialect",
      auth: Provider.keyless,
      apis: { responses: Dialect.at("https://dialect.test/v1") },
    }).model("m")
    expect(model.route.protocol).toBe("dialect-responses")
    expect((await compile(model)).body).toMatchObject({ dialect: true, store: false })
  })
})

describe("Capabilities", () => {
  test("merges later layers over earlier ones, keeping explicit false", () => {
    expect(
      Capabilities.merge(
        { reasoning: { updates: true, effort: ["low", "high"] }, system: { updates: true } },
        { reasoning: { effort: ["medium"] }, system: { updates: false } },
        undefined,
      ),
    ).toEqual({ reasoning: { updates: true, effort: ["medium"] }, system: { updates: false } })
    expect(Capabilities.merge({ cache: { implicit: true } }, { cache: false })).toEqual({ cache: false })
  })

  test("round-trips today's split capabilities and compatibility records", () => {
    const caps: Capabilities.Any = {
      tools: { strict: false, sanitizer: "gemini", stream: true, updates: ["add"] },
      reasoning: { updates: true, field: "reasoning", required: false, signature: true, thinkingBlockBinding: true },
      cache: { implicit: true, format: "alibaba", promptCacheKey: true },
      output: { maxTokensField: "max_tokens", streamUsage: false, requireFinishReason: false, structured: true },
      sampling: { temperature: false },
      system: { updates: true },
      messages: { requireAssistantAfterTool: true },
      store: false,
    }
    expect(Capabilities.fromProjection(Capabilities.project(caps))).toEqual(caps)
    expect(Capabilities.project(undefined)).toEqual({})
    expect(Capabilities.project({ store: true })).toEqual({ capabilities: { store: true } })
  })
})
