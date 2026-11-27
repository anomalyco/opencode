import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Headers } from "effect/http"
import { Api } from "../src/api.js"
import { Capabilities } from "../src/capabilities.js"
import { LLM } from "../src/llm.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { Provider } from "../src/provider.js"
import { Auth } from "../src/route/auth.js"
import { canCompact, compileRequest } from "../src/route/client.js"
import type { LLMRequest } from "../src/schema/index.js"

const compile = (model: LLMRequest["model"]) =>
  Effect.runPromise(compileRequest(LLM.request({ model, prompt: "hi", maxTokens: 10 })))

const authHeaders = (model: LLMRequest["model"]) =>
  Effect.runPromise(
    Auth.toEffect(model.auth)({ request: {}, method: "POST", url: "https://x.test", body: "", headers: Headers.empty }),
  )

const example = Provider.make({
  id: "example",
  baseURL: "https://api.example.test/v1",
  auth: Provider.apiKey("EXAMPLE_API_KEY"),
  apis: [
    OpenAIChat.api.configure({
      capabilities: { output: { maxTokensField: "max_tokens" } },
      models: {
        "big-*": { reasoning: { field: "reasoning_content" } },
        "big-2*": { reasoning: { field: "reasoning" } },
      },
    }),
    OpenAIResponses.api.configure({
      baseURL: "https://responses.example.test/v1",
      capabilities: { compaction: { trigger: false } },
    }),
  ],
}).with({ apiKey: "fixture" })

describe("Provider.model", () => {
  test("uses the first API unless one is named", () => {
    expect(example.model("m").api.name).toBe("chat-completions")
    expect(example.model("m", { api: "responses" }).api.name).toBe("responses")
    expect(example.model("m").baseURL).toBe("https://api.example.test/v1")
    expect(example.model("m", { api: "responses" }).baseURL).toBe("https://responses.example.test/v1")
    expect(example.model("m").provider).toBe("example")
    expect(example.model("m").metadataKey).toBe("example")
  })

  test("rejects an API the provider does not serve", () => {
    // @ts-expect-error not one of the provider's APIs
    expect(() => example.model("m", { api: "messages" })).toThrow("does not serve a messages API")
  })

  test("rejects an API listed twice", () => {
    const apis = [OpenAIChat.api, OpenAIChat.api.configure({ baseURL: "https://other.test" })]
    expect(() => Provider.make({ id: "twice", auth: Provider.keyless, apis })).toThrow(
      "lists API chat-completions twice",
    )
  })

  test("layers capabilities: API default, model patterns in order, host facts, then the caller", () => {
    expect(example.model("small").capabilities).toEqual({ output: { maxTokensField: "max_tokens" } })
    expect(example.model("BIG-1").capabilities?.reasoning?.field).toBe("reasoning_content")
    expect(example.model("big-2").capabilities?.reasoning?.field).toBe("reasoning")
    const passed = example.model("big-1", {
      capabilities: { output: { maxTokensField: "max_completion_tokens" }, reasoning: { field: "custom" } },
    })
    expect(passed.capabilities).toEqual({
      output: { maxTokensField: "max_completion_tokens" },
      reasoning: { field: "custom" },
    })
  })

  test("sends the capabilities on the wire", async () => {
    expect((await compile(example.model("m"))).body).toMatchObject({ max_tokens: 10 })
    expect(
      (await compile(example.model("m", { capabilities: { output: { maxTokensField: "max_completion_tokens" } } })))
        .body,
    ).toMatchObject({ max_completion_tokens: 10 })
  })

  test("compaction follows the host's capabilities", () => {
    const model = example.model("m", { api: "responses" })
    expect(canCompact(model)).toBe(true)
    expect(canCompact(model, { mechanism: "trigger" })).toBe(false)
    expect(canCompact(example.model("m"))).toBe(false)
  })

  test("needs a base URL", () => {
    const bare = Provider.make({ id: "bare", auth: Provider.keyless, apis: [OpenAIChat.api] })
    expect(() => bare.model("m")).toThrow("needs a baseURL")
    expect(bare.with({ baseURL: "https://x.test" }).model("m").baseURL).toBe("https://x.test")
  })
})

describe("Provider.with", () => {
  test("replaces every API's base URL and merges headers, query and body", () => {
    const patched = example.with({ baseURL: "https://proxy.test", headers: { a: "1" }, query: { v: "1" } }).with({
      headers: { b: "2" },
      body: { extra: true },
    })
    const model = patched.model("m", { api: "responses" })
    expect(model.baseURL).toBe("https://proxy.test")
    expect(model.query).toEqual({ v: "1" })
    expect(model.options?.headers).toEqual({ a: "1", b: "2" })
    expect(model.options?.http?.body).toEqual({ extra: true })
  })

  test("resolves auth by kind", async () => {
    expect((await authHeaders(example.model("m"))).authorization).toBe("Bearer fixture")
    expect((await authHeaders(example.with({ apiKey: false }).model("m"))).authorization).toBeUndefined()
    const custom = example.with({ auth: Auth.headers({ "x-key": "custom" }) }).model("m")
    expect((await authHeaders(custom))["x-key"]).toBe("custom")
    const keyless = Provider.make({
      id: "local",
      baseURL: "http://localhost",
      auth: Provider.keyless,
      apis: example.apis,
    })
    expect(keyless.auth.kind).toBe("none")
    expect((await authHeaders(keyless.model("m"))).authorization).toBeUndefined()
  })
})

describe("Provider.entrypoint", () => {
  test("splits flat settings into connection settings, provider keys and provider options", () => {
    const provider = Provider.make({
      id: "example",
      baseURL: "https://api.example.test/v1",
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
    expect(model.api.name).toBe("responses")
    expect(model.baseURL).toBe("https://proxy.test")
    expect(model.options?.headers).toEqual({ "x-team": "override" })
    expect(model.options?.http?.body).toEqual({ extra: true })
    expect(model.options?.providerOptions).toMatchObject({ reasoningEffort: "high" })
    expect(model.options?.providerOptions).not.toHaveProperty("team")
  })
})

describe("Api.extend", () => {
  test("inherits the parent's codec rules and name, and wraps its body builder", async () => {
    const Dialect = OpenAIResponses.api.extend({
      id: "dialect-responses",
      body: (request, base) => base(request).pipe(Effect.map((body) => ({ ...body, dialect: true }))),
    })
    expect(Dialect.name).toBe("responses")
    expect(Dialect.protocol.toolUpdates).toBe(OpenAIResponses.api.protocol.toolUpdates)
    expect(Dialect.protocol.supportsEffortUpdates).toBe(OpenAIResponses.api.protocol.supportsEffortUpdates)
    expect(Dialect.compact).toBe(OpenAIResponses.api.compact)
    const model = Provider.make({
      id: "dialect",
      baseURL: "https://dialect.test/v1",
      auth: Provider.keyless,
      apis: [Dialect],
    }).model("m", { api: "responses" })
    expect(model.api.id).toBe("dialect-responses")
    expect((await compile(model)).body).toMatchObject({ dialect: true, store: false })
  })
})

describe("Capabilities", () => {
  test("merges later layers over earlier ones, keeping explicit false and dropping unset fields", () => {
    expect(
      Capabilities.merge(
        { reasoning: { updates: true, effort: ["low", "high"] }, system: { updates: true } },
        { reasoning: { effort: ["medium"] }, system: { updates: false } },
        undefined,
        { output: { maxTokensField: undefined } },
      ),
    ).toEqual({ reasoning: { updates: true, effort: ["medium"] }, system: { updates: false } })
    expect(Capabilities.merge({ cache: { implicit: true } }, { cache: false })).toEqual({ cache: false })
    expect(Capabilities.merge({ output: { maxTokensField: undefined } })).toBeUndefined()
  })

  test("model patterns match case-insensitively with * globs", () => {
    expect(Api.modelCapabilities({ "a.b-*": { store: true } }, "A.B-1")).toEqual({ store: true })
    expect(Api.modelCapabilities({ "a.b-*": { store: true } }, "axb-1")).toBeUndefined()
  })
})
