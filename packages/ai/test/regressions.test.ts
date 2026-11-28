import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/llm.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { Alibaba, OpenRouter } from "../src/providers.js"
import { compileRequest } from "../src/route/client.js"
import { ToolDefinition, ToolNamespace, type CachePolicy, type LLMRequest } from "../src/schema/index.js"
import { apiModel } from "./lib/model.js"

const body = (model: LLMRequest["model"], cache?: CachePolicy, tools: LLMRequest["tools"] = []) =>
  Effect.runPromise(compileRequest(LLM.request({ model, system: "Be brief.", prompt: "hi", cache, tools }))).then(
    (compiled) => JSON.stringify(compiled.body),
  )

describe("gateway cache placement", () => {
  const openrouter = (id: string) => OpenRouter.model(id, { apiKey: "test" })

  test("auto places markers only for Anthropic and Qwen upstreams", async () => {
    expect(await body(openrouter("openai/gpt-6"))).not.toContain("cache_control")
    expect(await body(openrouter("anthropic/claude-sonnet-5"))).toContain("cache_control")
    expect(await body(openrouter("~anthropic/claude-sonnet-latest"))).toContain("cache_control")
    expect(await body(openrouter("~qwen/qwen3-max"))).toContain("cache_control")
  })

  test("an explicit layout is sent for every upstream", async () => {
    expect(await body(openrouter("openai/gpt-6"), { system: true })).toContain("cache_control")
    expect(
      await body(Alibaba.model("deepseek-v4", { region: "ap-southeast-1", apiKey: "test" }), { system: true }),
    ).toContain("cache_control")
    expect(await body(Alibaba.model("deepseek-v4", { region: "ap-southeast-1", apiKey: "test" }))).not.toContain(
      "cache_control",
    )
  })
})

describe("Api.extend", () => {
  test("a replaced body builder receives flattened tool namespaces", async () => {
    const seen: Array<string> = []
    const Dialect = OpenAIChat.api.extend({
      id: "dialect-chat",
      body: (request, base) => {
        seen.push(...request.tools.map((tool) => tool.name))
        return base(request)
      },
    })
    const model = apiModel(Dialect, "m", { baseURL: "https://dialect.test/v1" })
    const read = ToolDefinition.make({ name: "read", description: "Read", inputSchema: { type: "object" } })
    await body(model, undefined, [ToolNamespace.make({ name: "fs", description: "Files", tools: [read] })])
    expect(seen).toEqual(["fs_read"])
  })
})

describe("Alibaba", () => {
  test("a provider setting renames the provider and its metadata namespace", () => {
    const model = Alibaba.model("qwen3.8-max", { region: "ap-southeast-1", apiKey: "test", provider: "my-qwen" })
    expect(String(model.provider)).toBe("my-qwen")
    expect(model.metadataKey).toBe("my-qwen")
    expect(model.options?.providerOptions).not.toHaveProperty("provider")
  })
})
