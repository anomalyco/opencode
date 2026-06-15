import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

const options = [
  { type: "toggle" },
  { type: "effort", values: [null, "low", "medium", "high", "xhigh", "max", "ultrathink"] },
  { type: "budget_tokens", min: 1024 },
  { type: "budget_tokens", min: 0, max: 24_576 },
]

describe("reasoning_options schemas", () => {
  test("models.dev model schema decodes all known option shapes", () => {
    const model = Schema.decodeUnknownSync(ModelsDev.Model)({
      id: "test-model",
      name: "Test Model",
      release_date: "2026-01-01",
      attachment: false,
      reasoning: true,
      reasoning_options: options,
      temperature: true,
      tool_call: true,
      limit: { context: 128000, output: 8192 },
    })
    expect(model.reasoning_options).toEqual(options as typeof model.reasoning_options)
  })

  test("config model schema decodes reasoning_options", () => {
    const model = Schema.decodeUnknownSync(ConfigProviderV1.Model)({ reasoning_options: options })
    expect(model.reasoning_options).toEqual(options as typeof model.reasoning_options)
  })

  test("provider capabilities decode sanitized reasoningOptions", () => {
    const resolved = [
      { type: "toggle" },
      { type: "effort", values: ["low", "medium", "high", "xhigh", "max", "ultrathink"] },
      { type: "budget_tokens", min: 1024 },
      { type: "budget_tokens", min: 0, max: 24_576 },
    ]
    const capabilities = Schema.decodeUnknownSync(Provider.Model.fields.capabilities)({
      temperature: true,
      reasoning: true,
      reasoningOptions: resolved,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    })
    expect(capabilities.reasoningOptions).toEqual(resolved as typeof capabilities.reasoningOptions)
    expect(() =>
      Schema.decodeUnknownSync(Provider.Model.fields.capabilities)({
        temperature: true,
        reasoning: true,
        reasoningOptions: [{ type: "effort", values: [null, "low"] }],
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      }),
    ).toThrow()
  })
})

describe("ProviderTransform.variants - models.dev reasoning_options", () => {
  const createModel = (overrides: Partial<any> = {}): Provider.Model =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 200_000, output: 64_000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
      ...overrides,
    }) as Provider.Model

  const withOptions = (model: Provider.Model, reasoningOptions: any[]) => {
    model.capabilities.reasoningOptions = reasoningOptions
    return model
  }

  test("effort values drive GLM variants for openai-compatible packages", () => {
    const model = withOptions(
      createModel({
        id: "zhipuai-coding-plan/glm-5.2",
        providerID: "zhipuai-coding-plan",
        api: { id: "glm-5.2", url: "", npm: "@ai-sdk/openai-compatible" },
      }),
      [{ type: "toggle" }, { type: "effort", values: ["high", "max"] }],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    })
  })

  test("openai packages include summaries and encrypted reasoning", () => {
    const model = withOptions(createModel({ api: { id: "gpt-x", url: "", npm: "@ai-sdk/openai" } }), [
      { type: "effort", values: ["low", "high"] },
    ])
    expect(ProviderTransform.variants(model)).toEqual({
      low: { reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
      high: { reasoningEffort: "high", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
    })
  })

  test("null efforts, duplicates, and unknown option types are ignored", () => {
    const model = withOptions(createModel(), [
      { type: "future-thing", anything: true },
      { type: "effort", values: [null, "low"] },
      { type: "effort", values: ["low", "high"] },
    ])
    expect(ProviderTransform.variants(model)).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    })
  })

  test("toggle-only data falls back to hardcoded variants", () => {
    const model = withOptions(
      createModel({
        id: "minimax/minimax-m3",
        providerID: "minimax",
        api: { id: "MiniMax-M3", url: "", npm: "@ai-sdk/anthropic" },
      }),
      [{ type: "toggle" }],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    })
  })

  test("anthropic adaptive models wrap effort in adaptive thinking", () => {
    const model = withOptions(
      createModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-6", url: "", npm: "@ai-sdk/anthropic" },
      }),
      [
        { type: "effort", values: ["low", "medium", "high", "max"] },
        { type: "budget_tokens", min: 1024 },
      ],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      low: { thinking: { type: "adaptive" }, effort: "low" },
      medium: { thinking: { type: "adaptive" }, effort: "medium" },
      high: { thinking: { type: "adaptive" }, effort: "high" },
      max: { thinking: { type: "adaptive" }, effort: "max" },
    })
  })

  test("anthropic non-adaptive models encode efforts as plain effort", () => {
    const model = withOptions(
      createModel({
        id: "anthropic/claude-opus-4-5",
        providerID: "anthropic",
        api: { id: "claude-opus-4-5", url: "", npm: "@ai-sdk/anthropic" },
      }),
      [{ type: "effort", values: ["low", "medium", "high"] }],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      low: { effort: "low" },
      medium: { effort: "medium" },
      high: { effort: "high" },
    })
  })

  test("github-copilot anthropic models filter unsupported efforts", () => {
    const model = withOptions(
      createModel({
        id: "github-copilot/claude-sonnet-4-6",
        providerID: "github-copilot",
        api: { id: "claude-sonnet-4-6", url: "", npm: "@ai-sdk/anthropic" },
      }),
      [{ type: "effort", values: ["low", "medium", "high", "max"] }],
    )
    expect(Object.keys(ProviderTransform.variants(model))).toEqual(["low", "medium", "high"])
  })

  test("openrouter encodes efforts as reasoning.effort", () => {
    const model = withOptions(
      createModel({
        id: "openrouter/x-ai/grok-4.3",
        providerID: "openrouter",
        api: { id: "x-ai/grok-4.3", url: "", npm: "@openrouter/ai-sdk-provider" },
      }),
      [{ type: "effort", values: ["low", "high"] }],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      low: { reasoning: { effort: "low" } },
      high: { reasoning: { effort: "high" } },
    })
  })

  test("google encodes efforts as thinkingConfig levels", () => {
    const model = withOptions(
      createModel({
        id: "google/gemini-3-pro-preview",
        providerID: "google",
        api: { id: "gemini-3-pro-preview", url: "", npm: "@ai-sdk/google" },
      }),
      [{ type: "effort", values: ["low", "high"] }],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      low: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } },
      high: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
    })
  })

  test("bedrock non-adaptive models encode efforts as maxReasoningEffort", () => {
    const model = withOptions(
      createModel({
        id: "amazon-bedrock/anthropic.claude-opus-4-5-20251101-v1:0",
        providerID: "amazon-bedrock",
        api: { id: "anthropic.claude-opus-4-5-20251101-v1:0", url: "", npm: "@ai-sdk/amazon-bedrock" },
      }),
      [{ type: "effort", values: ["low", "medium", "high"] }],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      low: { reasoningConfig: { type: "enabled", maxReasoningEffort: "low" } },
      medium: { reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" } },
      high: { reasoningConfig: { type: "enabled", maxReasoningEffort: "high" } },
    })
  })

  test("sap anthropic adaptive models wrap efforts in modelParams", () => {
    const model = withOptions(
      createModel({
        id: "sap-ai-core/anthropic--claude-4.6-sonnet",
        providerID: "sap-ai-core",
        api: { id: "anthropic--claude-4.6-sonnet", url: "", npm: "@jerome-benoit/sap-ai-provider-v2" },
      }),
      [{ type: "effort", values: ["low", "max"] }],
    )
    expect(ProviderTransform.variants(model)).toEqual({
      low: { modelParams: { thinking: { type: "adaptive" }, output_config: { effort: "low" } } },
      max: { modelParams: { thinking: { type: "adaptive" }, output_config: { effort: "max" } } },
    })
  })

  test("unknown packages default to openai-compatible reasoningEffort", () => {
    const model = withOptions(createModel({ api: { id: "some-model", url: "", npm: "@ai-sdk/some-future-sdk" } }), [
      { type: "effort", values: ["low", "ultrathink"] },
    ])
    expect(ProviderTransform.variants(model)).toEqual({
      low: { reasoningEffort: "low" },
      ultrathink: { reasoningEffort: "ultrathink" },
    })
  })
})
