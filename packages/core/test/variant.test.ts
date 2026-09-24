import { expect, test } from "bun:test"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Variant } from "@opencode/core/variant"

const model = (packageName: string, modelID: string, output?: number, providerID = "test") => {
  const result = Model.Info.default(Provider.ID.make(providerID), Model.ID.make(modelID)) as Model.MutableInfo
  result.package = packageName
  result.modelID = Model.ID.make(modelID)
  if (output !== undefined) result.limit = { ...result.limit, output }
  return Model.Info.make(result)
}

const resolve = (input: Model.Info, supports: readonly Variant.Support[]) =>
  Variant.resolve(input, supports).map((item) => ({ ...item, id: String(item.id) }))

test("spells Messages variants for each provider", () => {
  expect(
    resolve(model("@opencode/ai/providers/anthropic", "claude-opus-4-5"), [
      { type: "effort", values: ["low", "high"] },
      { type: "budget_tokens", min: 1024 },
    ]),
  ).toEqual([
    {
      id: "low",
      settings: { effort: "low", thinking: { type: "enabled", budgetTokens: 16_000 } },
    },
    {
      id: "high",
      settings: { effort: "high", thinking: { type: "enabled", budgetTokens: 16_000 } },
    },
  ])

  expect(
    resolve(model("@opencode/ai/providers/anthropic", "claude-opus-4-8"), [{ type: "effort", values: ["low", "max"] }]),
  ).toEqual([
    { id: "low", settings: { effort: "low", thinking: { type: "adaptive", display: "summarized" } } },
    { id: "max", settings: { effort: "max", thinking: { type: "adaptive", display: "summarized" } } },
  ])

  expect(resolve(model("@opencode/ai/providers/minimax/messages", "MiniMax-M3"), [{ type: "toggle" }])).toEqual([
    { id: "none", settings: { thinking: { type: "disabled" } } },
    { id: "thinking", settings: { thinking: { type: "adaptive" } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/moonshot/messages", "k3"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "high", "max"] },
    ]),
  ).toEqual([
    { id: "low", settings: { effort: "low" } },
    { id: "high", settings: { effort: "high" } },
    { id: "max", settings: { effort: "max" } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/alibaba/messages", "qwen3.8-max"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "medium", "xhigh"] },
      { type: "budget_tokens", min: 1024, max: 262_144 },
    ]),
  ).toEqual([
    { id: "none", settings: { thinking: { type: "disabled" } } },
    { id: "low", settings: { effort: "low", thinking: { type: "enabled" } } },
    { id: "medium", settings: { effort: "medium", thinking: { type: "enabled" } } },
    { id: "xhigh", settings: { effort: "xhigh", thinking: { type: "enabled" } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/zai-coding-plan/messages", "glm-5.3"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "high", "max"] },
      { type: "budget_tokens", min: 1024 },
    ]),
  ).toEqual([
    { id: "low", settings: { effort: "low", thinking: { type: "enabled" } } },
    { id: "high", settings: { effort: "high", thinking: { type: "enabled" } } },
    { id: "max", settings: { effort: "max", thinking: { type: "enabled" } } },
  ])
})

test("recognizes Claude version spellings and future models", () => {
  for (const id of ["claude-sonnet-3.7", "claude-sonnet-3-7", "claude-3.7-sonnet", "claude-3-7-sonnet"])
    expect(resolve(model("@opencode/ai/providers/anthropic", id), [{ type: "effort" }])).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
      { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 31999 } } },
    ])

  expect(resolve(model("@opencode/ai/providers/anthropic", "claude-opus-6"), [{ type: "effort" }])).toEqual(
    ["low", "medium", "high", "xhigh", "max"].map((effort) => ({
      id: effort,
      settings: { effort, thinking: { type: "adaptive", display: "summarized" } },
    })),
  )

  expect(
    resolve(model("@opencode/ai/providers/anthropic", "claude-haiku-4-5", 64_000), [
      { type: "budget_tokens", min: 1_024, max: 64_000 },
    ]),
  ).toEqual([
    { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16_000 } } },
    { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 31_999 } } },
  ])
})

test("spells Cloudflare AI Gateway variants for their upstream routes", () => {
  const pkg = "@opencode/ai/providers/cloudflare-ai-gateway"
  expect(resolve(model(pkg, "openai/gpt-5.4"), [{ type: "effort", values: ["low", "xhigh"] }])).toEqual([
    {
      id: "low",
      settings: { reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
    },
    {
      id: "xhigh",
      settings: { reasoningEffort: "xhigh", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
    },
  ])
  expect(resolve(model(pkg, "anthropic/claude-sonnet-4-6"), [{ type: "effort", values: ["low", "high"] }])).toEqual([
    { id: "low", settings: { effort: "low", thinking: { type: "adaptive", display: "summarized" } } },
    { id: "high", settings: { effort: "high", thinking: { type: "adaptive", display: "summarized" } } },
  ])
  expect(resolve(model(pkg, "xai/grok-4.6"), [{ type: "effort", values: ["low", "high"] }])).toEqual([
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ])
})

test("spells Chat Completions variants for direct providers", () => {
  expect(
    resolve(model("@opencode/ai/providers/deepseek", "deepseek-v4-flash"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "high", "max"] },
    ]),
  ).toEqual([
    { id: "none", body: { thinking: { type: "disabled" } } },
    { id: "low", settings: { reasoningEffort: "low" }, body: { thinking: { type: "enabled" } } },
    { id: "high", settings: { reasoningEffort: "high" }, body: { thinking: { type: "enabled" } } },
    { id: "max", settings: { reasoningEffort: "max" }, body: { thinking: { type: "enabled" } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/moonshot/chat", "kimi-k3"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "high", "max"] },
    ]),
  ).toEqual([
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "high", settings: { reasoningEffort: "high" } },
    { id: "max", settings: { reasoningEffort: "max" } },
  ])

  expect(resolve(model("@opencode/ai/providers/moonshot/chat", "kimi-k2.6"), [{ type: "toggle" }])).toEqual([
    { id: "none", settings: { thinking: { type: "disabled" } } },
    { id: "thinking", settings: { thinking: { type: "enabled" } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/alibaba/chat", "qwen3.8-max"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "medium", "xhigh"] },
      { type: "budget_tokens", min: 0, max: 262_144 },
    ]),
  ).toEqual([
    { id: "none", settings: { enableThinking: false } },
    { id: "low", settings: { enableThinking: true, reasoningEffort: "low" } },
    { id: "medium", settings: { enableThinking: true, reasoningEffort: "medium" } },
    { id: "xhigh", settings: { enableThinking: true, reasoningEffort: "xhigh" } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/alibaba/chat", "qwen3.7-plus", 300_000), [
      { type: "toggle" },
      { type: "budget_tokens", min: 0, max: 262_144 },
    ]),
  ).toEqual([
    { id: "none", settings: { enableThinking: false } },
    { id: "high", settings: { enableThinking: true, thinkingBudget: 131_072 } },
    { id: "max", settings: { enableThinking: true, thinkingBudget: 262_144 } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/zai/chat", "glm-5.3"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "high", "max"] },
    ]),
  ).toEqual([
    { id: "low", settings: { thinking: { type: "enabled", clear_thinking: false }, reasoningEffort: "low" } },
    { id: "high", settings: { thinking: { type: "enabled", clear_thinking: false }, reasoningEffort: "high" } },
    { id: "max", settings: { thinking: { type: "enabled", clear_thinking: false }, reasoningEffort: "max" } },
  ])

  expect(resolve(model("@opencode/ai/providers/zai/chat", "glm-4.7"), [{ type: "toggle" }])).toEqual([
    { id: "none", settings: { thinking: { type: "disabled" } } },
    { id: "thinking", settings: { thinking: { type: "enabled", clear_thinking: false } } },
  ])
})

test("spells Chat Completions variants for hosting providers", () => {
  expect(
    resolve(model("@opencode/ai/providers/openai-compatible", "deepseek-ai/deepseek-v4-pro", undefined, "nvidia"), [
      { type: "effort", values: ["none", "high", "max"] },
    ]),
  ).toEqual([
    { id: "none", body: { chat_template_kwargs: { thinking: false } } },
    { id: "high", body: { chat_template_kwargs: { thinking: true, reasoning_effort: "high" } } },
    { id: "max", body: { chat_template_kwargs: { thinking: true, reasoning_effort: "max" } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/openai-compatible", "moonshotai/kimi-k2.6", undefined, "nvidia"), [
      { type: "effort", values: ["none", "low", "high", "max"] },
    ]),
  ).toEqual([
    { id: "none", body: { chat_template_kwargs: { thinking: false } } },
    { id: "thinking", body: { chat_template_kwargs: { thinking: true } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/openai-compatible", "moonshotai/kimi-k3", undefined, "nvidia"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "high", "max"] },
    ]),
  ).toEqual([
    { id: "none", body: { chat_template_kwargs: { thinking: false } } },
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "high", settings: { reasoningEffort: "high" } },
    { id: "max", settings: { reasoningEffort: "max" } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/openai-compatible", "minimaxai/minimax-m3", undefined, "nvidia"), [
      { type: "toggle" },
    ]),
  ).toEqual([
    { id: "none", body: { chat_template_kwargs: { thinking_mode: "disabled" } } },
    { id: "thinking", body: { chat_template_kwargs: { thinking_mode: "enabled" } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/baseten", "zai-org/GLM-5.2"), [
      { type: "effort", values: ["none", "high", "max"] },
    ]),
  ).toEqual([
    {
      id: "none",
      settings: { reasoningEffort: "none" },
      body: { chat_template_args: { enable_thinking: false } },
    },
    {
      id: "high",
      settings: { reasoningEffort: "high" },
      body: { chat_template_args: { enable_thinking: true } },
    },
    {
      id: "max",
      settings: { reasoningEffort: "max" },
      body: { chat_template_args: { enable_thinking: true } },
    },
  ])

  expect(resolve(model("@opencode/ai/providers/baseten", "moonshotai/Kimi-K2.6"), [{ type: "toggle" }])).toEqual([
    { id: "none", body: { chat_template_args: { enable_thinking: false } } },
    { id: "thinking", body: { chat_template_args: { enable_thinking: true } } },
  ])

  expect(
    resolve(model("@opencode/ai/providers/deepinfra", "zai-org/GLM-5.2"), [
      { type: "toggle" },
      { type: "effort", values: ["low", "high", "xhigh"] },
    ]),
  ).toEqual([
    { id: "none", body: { reasoning: { enabled: false } } },
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "high", settings: { reasoningEffort: "high" } },
    { id: "xhigh", settings: { reasoningEffort: "xhigh" } },
  ])
})

test("spells GitLab Duo variants for gitlab-ai-provider routes", () => {
  const pkg = Provider.aisdk("gitlab-ai-provider")
  const gitlab = (id: string, output?: number) => model(pkg, id, output, "gitlab")

  expect(
    resolve(gitlab("duo-chat-opus-5-5"), [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }]),
  ).toEqual(
    ["low", "medium", "high", "xhigh", "max"].map((effort) => ({
      id: effort,
      settings: { thinking: { type: "adaptive", effort } },
    })),
  )

  expect(
    resolve(gitlab("duo-chat-sonnet-5"), [{ type: "toggle" }, { type: "effort", values: ["low", "max"] }]),
  ).toEqual([
    { id: "none", settings: { thinking: { type: "disabled" } } },
    { id: "low", settings: { thinking: { type: "adaptive", effort: "low" } } },
    { id: "max", settings: { thinking: { type: "adaptive", effort: "max" } } },
  ])

  expect(resolve(gitlab("duo-chat-fable-5-1"), [{ type: "toggle" }, { type: "effort", values: ["high"] }])).toEqual([
    { id: "high", settings: { thinking: { type: "adaptive", effort: "high" } } },
  ])

  expect(resolve(gitlab("duo-chat-opus-4-5", 64_000), [{ type: "effort" }])).toEqual([
    { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16_000 } } },
    { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 31_999 } } },
  ])

  expect(resolve(gitlab("duo-chat-gpt-6-sol"), [{ type: "effort", values: ["none", "low", "max"] }])).toEqual([
    { id: "none", settings: { reasoningEffort: "none" } },
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "max", settings: { reasoningEffort: "max" } },
  ])

  expect(resolve(gitlab("duo-chat-gpt-5-3-codex"), [{ type: "effort", values: ["low"] }])).toEqual([
    { id: "low", settings: { reasoningEffort: "low" } },
  ])

  expect(resolve(gitlab("duo-chat-gpt-5-4"), [])).toEqual([])
  expect(resolve(gitlab("duo-workflow-opus-5-5"), [{ type: "effort" }])).toEqual([])
})
