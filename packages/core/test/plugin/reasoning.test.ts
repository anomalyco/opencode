import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ReasoningPlugin } from "@opencode/core/plugin/reasoning"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const ref = (providerID: string, id: string, variant?: string) =>
  Model.Ref.make({
    providerID: Provider.ID.make(providerID),
    id: Model.ID.make(id),
    ...(variant ? { variant: Model.VariantID.make(variant) } : {}),
  })
const request = (model: Model.Ref, options: SessionHooks["context"]["options"] = {}): SessionHooks["context"] => ({
  sessionID: Session.ID.make("ses_reasoning"),
  agent: Agent.ID.make("build"),
  model,
  system: [],
  messages: [],
  tools: {},
  options,
})
const defaults = { reasoningEffort: "medium", reasoningSummary: "auto" }

it.effect("sets GPT-5 Responses reasoning defaults without overriding configured or other models", () =>
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const plugins = yield* Plugin.Service
    const hooks = yield* PluginHooks.Service
    yield* providers.transform((editor) => {
      editor.add({
        info: { ...Provider.Info.empty(Provider.ID.make("openai")), package: "@opencode/ai/providers/openai" },
        models: [
          Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.4")),
          Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5-chat-latest")),
          Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5-pro")),
          Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-4.1")),
          {
            ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.5")),
            variants: [{ id: Model.VariantID.make("high"), settings: { reasoningEffort: "high" } }],
          },
          {
            ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("chat")),
            modelID: Model.ID.make("gpt-5.4"),
            package: "@opencode/ai/providers/openai/chat",
          },
          {
            ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("configured")),
            modelID: Model.ID.make("gpt-5.4"),
            settings: { reasoningEffort: "low" },
          },
        ],
      })
      for (const [providerID, packageName, modelID] of [
        ["azure", "@opencode/ai/providers/azure/responses", "gpt-5.5"],
        ["bedrock-mantle", "@opencode/ai/providers/amazon-bedrock/mantle/responses", "openai.gpt-5.4"],
        ["openrouter", "@opencode/ai/providers/openrouter", "openai/gpt-5.4"],
      ] as const) {
        editor.add({
          info: { ...Provider.Info.empty(Provider.ID.make(providerID)), package: packageName },
          models: [
            {
              ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make("selected")),
              modelID: Model.ID.make(modelID),
            },
          ],
        })
      }
    })
    yield* ReasoningPlugin.Plugin.effect(yield* PluginHost.make(plugins))

    for (const kind of ["context", "compaction", "generate", "title"] as const) {
      const event = request(ref("openai", "gpt-5.4"))
      yield* hooks.trigger("session", kind, event)
      expect(event.options).toEqual(defaults)
    }

    for (const model of [ref("openai", "gpt-5.5"), ref("azure", "selected"), ref("bedrock-mantle", "selected")]) {
      const event = request(model)
      yield* hooks.trigger("session", "context", event)
      expect(event.options).toEqual(defaults)
    }

    for (const model of [
      ref("openai", "gpt-5-chat-latest"),
      ref("openai", "gpt-5-pro"),
      ref("openai", "gpt-4.1"),
      ref("openai", "chat"),
      ref("openrouter", "selected"),
    ]) {
      const event = request(model)
      yield* hooks.trigger("session", "context", event)
      expect(event.options).toEqual({})
    }

    const variant = request(ref("openai", "gpt-5.5", "high"))
    yield* hooks.trigger("session", "context", variant)
    expect(variant.options).toEqual({ reasoningSummary: "auto" })

    const configured = request(ref("openai", "configured"))
    yield* hooks.trigger("session", "context", configured)
    expect(configured.options).toEqual({ reasoningSummary: "auto" })

    const overridden = request(ref("openai", "gpt-5.4"), { reasoningEffort: "none" })
    yield* hooks.trigger("session", "context", overridden)
    expect(overridden.options).toEqual({ reasoningEffort: "none", reasoningSummary: "auto" })
  }),
)
