import { describe, expect, test } from "bun:test"
import { DEFAULT_BASE_URL, DEFAULT_REFRESH_INTERVAL_MS, MIN_REFRESH_INTERVAL_MS, parseModels, resolveOptions, toModel } from "../hostman.js"

describe("resolveOptions", () => {
  test("falls back to defaults", () => {
    expect(resolveOptions(undefined, {})).toEqual({
      baseURL: DEFAULT_BASE_URL,
      envVar: "HOSTMAN_API_KEY",
      refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
    })
  })

  test("flat options win over environment", () => {
    const options = resolveOptions(
      { baseURL: "https://example.com/v1/", envVar: "MY_KEY" },
      { HOSTMAN_BASE_URL: "https://env.example.com/v1" },
    )
    expect(options.baseURL).toBe("https://example.com/v1")
    expect(options.envVar).toBe("MY_KEY")
  })

  test("environment fills missing options", () => {
    const options = resolveOptions(undefined, { HOSTMAN_BASE_URL: "https://env.example.com/v1", HOSTMAN_ENV_VAR: "OTHER_KEY" })
    expect(options.baseURL).toBe("https://env.example.com/v1")
    expect(options.envVar).toBe("OTHER_KEY")
  })

  test("nested hostman object is merged, flat keys win", () => {
    const options = resolveOptions({ hostman: { baseURL: "https://nested.example.com/v1", envVar: "NESTED" }, envVar: "FLAT" })
    expect(options.baseURL).toBe("https://nested.example.com/v1")
    expect(options.envVar).toBe("FLAT")
  })

  test("strips trailing slashes from the base URL", () => {
    expect(resolveOptions({ baseURL: "https://example.com/v1///" }).baseURL).toBe("https://example.com/v1")
  })

  test("rejects non-http base URLs", () => {
    expect(() => resolveOptions({ baseURL: "example.com/v1" })).toThrow(/Invalid baseURL/)
  })

  test("clamps the refresh interval to the minimum", () => {
    expect(resolveOptions({ refreshIntervalMs: 1 }).refreshIntervalMs).toBe(MIN_REFRESH_INTERVAL_MS)
    expect(resolveOptions({ refreshIntervalMs: 600_000 }).refreshIntervalMs).toBe(600_000)
  })
})

describe("parseModels", () => {
  test("maps the OpenAI list shape", () => {
    const models = parseModels({
      object: "list",
      data: [
        { id: "openai/gpt-5-mini", object: "model", created: 1, owned_by: "openai" },
        { id: "anthropic/claude-sonnet-4", object: "model" },
      ],
    })
    expect(models.map((model) => String(model.id))).toEqual(["anthropic/claude-sonnet-4", "openai/gpt-5-mini"])
    expect(models.every((model) => String(model.providerID) === "hostman")).toBe(true)
  })

  test("accepts a bare array and skips duplicates", () => {
    const models = parseModels([
      { id: "openai/gpt-5-mini" },
      { id: "openai/gpt-5-mini" },
      { id: "openai/gpt-5-nano" },
    ])
    expect(models.map((model) => String(model.id))).toEqual(["openai/gpt-5-mini", "openai/gpt-5-nano"])
  })

  test("skips non-chat workloads and malformed entries", () => {
    const models = parseModels({
      data: [
        { id: "openai/text-embedding-3-small" },
        { id: "openai/whisper-1" },
        { id: "openai/gpt-image-1" },
        { id: "openai/sora-2" },
        { object: "model" },
        "not-an-object",
        { id: "openai/gpt-5-mini" },
      ],
    })
    expect(models.map((model) => String(model.id))).toEqual(["openai/gpt-5-mini"])
  })

  test("returns an empty list for unknown bodies", () => {
    expect(parseModels(undefined)).toEqual([])
    expect(parseModels({ error: { message: "nope" } })).toEqual([])
  })

  test("trusts the mode field over the id pattern", () => {
    const models = parseModels({
      data: [
        { id: "openai/gpt-5-mini", mode: "chat" },
        { id: "openai/gpt-5-mini-embed", mode: "embedding" },
        { id: "alibaba/wan3", mode: "video" },
        { id: "flux-custom", mode: "chat" },
      ],
    })
    expect(models.map((model) => String(model.id))).toEqual(["flux-custom", "openai/gpt-5-mini"])
  })

  test("filters mode-less entries by the id pattern", () => {
    const models = parseModels({
      data: [
        { id: "yandex/yandexgpt-lite" },
        { id: "black_forest_labs/flux-2-max" },
        { id: "alibaba/wan3" },
        { id: "openai/gpt-4o-transcribe" },
        { id: "gemini/gemini-nano-banana-2.1" },
        { id: "kling_ai/kling3.0_pro" },
      ],
    })
    expect(models.map((model) => String(model.id))).toEqual(["yandex/yandexgpt-lite"])
  })

  test("maps a realistic Hostman gateway response", () => {
    const models = parseModels({
      data: [
        {
          id: "openai/gpt-5.1",
          object: "model",
          created: 1,
          owned_by: "openai",
          mode: "chat",
          max_input_tokens: 272_000,
          max_output_tokens: 128_000,
        },
        {
          id: "dashscope/qwen3.8-max",
          object: "model",
          created: 1,
          owned_by: "openai",
          mode: "chat",
          max_input_tokens: 991_808,
          max_output_tokens: 131_072,
        },
        { id: "yandex/yandexgpt-lite", object: "model", created: 1, owned_by: "openai" },
        { id: "openai/text-embedding-3-small", object: "model", created: 1, owned_by: "openai", mode: "embedding" },
        { id: "kling_ai/kling3.0_pro", object: "model", created: 1, owned_by: "openai", mode: "video" },
      ],
    })
    expect(models.map((model) => String(model.id))).toEqual([
      "dashscope/qwen3.8-max",
      "openai/gpt-5.1",
      "yandex/yandexgpt-lite",
    ])
    const qwen = models.find((model) => String(model.id) === "dashscope/qwen3.8-max")
    expect(qwen?.limit).toEqual({ context: 991_808, output: 131_072 })
  })
})

describe("toModel", () => {
  test("applies catalog defaults", () => {
    const model = toModel("openai/gpt-5-mini")
    expect(String(model.id)).toBe("openai/gpt-5-mini")
    expect(String(model.modelID)).toBe("openai/gpt-5-mini")
    expect(model.name).toBe("openai/gpt-5-mini")
    expect(model.type).toBe("chat")
    expect(model.enabled).toBe(true)
    expect(model.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    expect(model.limit).toEqual({ context: 200_000, output: 32_000 })
    expect(model.cost).toEqual([])
  })

  test("reads gateway-reported metadata", () => {
    const model = toModel("deepseek/deepseek-v4", {
      name: "DeepSeek V4",
      context_length: 128_000,
      max_output_tokens: 8_192,
    })
    expect(model.name).toBe("DeepSeek V4")
    expect(model.limit).toEqual({ context: 128_000, output: 8_192 })
  })

  test("ignores invalid metadata values", () => {
    const model = toModel("meta/llama-4", { context_length: "huge", max_output_tokens: -1 })
    expect(model.limit).toEqual({ context: 200_000, output: 32_000 })
  })

  test("reads Hostman gateway limit fields", () => {
    const model = toModel("dashscope/qwen3.8-max", { max_input_tokens: 991_808, max_output_tokens: 131_072 })
    expect(model.limit).toEqual({ context: 991_808, output: 131_072 })
  })
})
