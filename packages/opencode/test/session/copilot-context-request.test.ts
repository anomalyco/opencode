import { expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Layer } from "effect"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { LLMRequestPrep } from "@/session/llm/request"

test.each([
  ["responses", "medium@long"],
  ["messages", "medium@long"],
  ["responses", "custom@long"],
  ["messages", "custom@long"],
] as const)(
  "prepare merges reasoning and strips local Copilot context options for %s/%s",
  async (endpoint, variant) => {
    const reasoning =
      endpoint === "responses"
        ? { reasoningEffort: "medium", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] }
        : { effort: "medium", thinking: { type: "adaptive", display: "summarized" } }
    const model: Provider.Model = {
      id: ModelV2.ID.make(endpoint === "responses" ? "gpt-5.4" : "claude-sonnet-4.6"),
      providerID: ProviderV2.ID.githubCopilot,
      api: {
        id: endpoint === "responses" ? "gpt-5.4" : "claude-sonnet-4.6",
        url: "https://copilot.invalid",
        npm: endpoint === "responses" ? "@ai-sdk/github-copilot" : "@ai-sdk/anthropic",
      },
      name: "Copilot test model",
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 2, output: 10, cache: { read: 0, write: 0 } },
      limit: { context: 1_050_000, input: 922_000, output: 128_000 },
      status: "active",
      options: {
        copilotContext: { default: 272_000, long: 922_000 },
        ...(endpoint === "responses" ? { reasoningEffort: "low" } : { effort: "low" }),
      },
      headers: {},
      release_date: "2026-10-01",
      variants: {
        "default@default": { copilotContextTier: "default" },
        "default@long": { copilotContextTier: "long" },
        "medium@long": { ...reasoning, copilotContextTier: "long" },
        custom: reasoning,
      },
    }
    const api = { ...model.api }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const flags = yield* RuntimeFlags.Service
        return yield* LLMRequestPrep.prepare({
          user: {
            id: MessageID.make("msg_copilot-context-test"),
            sessionID: SessionID.make("ses_copilot-context-test"),
            role: "user",
            time: { created: 0 },
            agent: "test",
            model: { providerID: model.providerID, modelID: model.id, variant },
          },
          sessionID: "ses_copilot-context-test",
          model,
          agent: {
            name: "test",
            mode: "primary",
            options: endpoint === "responses" ? { reasoningEffort: "high" } : { effort: "high" },
            permission: [],
          },
          system: [],
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
          provider: {
            id: model.providerID,
            name: "GitHub Copilot",
            source: "api",
            env: [],
            options: {},
            models: { [model.id]: model },
          },
          auth: undefined,
          plugin,
          flags,
          isWorkflow: false,
        })
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Plugin.Service, {
              trigger: (_name, _input, output) => Effect.succeed(output),
            }),
            RuntimeFlags.layer({ outputTokenMax: 32_000, client: "test" }),
          ),
        ),
      ),
    )

    expect(result.params.options).toMatchObject(reasoning)
    expect(result.params.options).not.toHaveProperty("copilotContext")
    expect(result.params.options).not.toHaveProperty("copilotContextTier")
    expect(model.api).toEqual(api)
    expect(model.options.copilotContext).toEqual({ default: 272_000, long: 922_000 })
    expect(model.variants?.["medium@long"]).toEqual({ ...reasoning, copilotContextTier: "long" })
  },
)
