export * as ReasoningPlugin from "./reasoning.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionRequest } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import { Model } from "../model.js"
import type { PluginInternal } from "./internal.js"

const responses = new Set([
  "@opencode/ai/providers/openai",
  "@opencode/ai/providers/openai/responses",
  "@opencode/ai/providers/azure",
  "@opencode/ai/providers/azure/responses",
  "@opencode/ai/providers/amazon-bedrock/mantle",
  "@opencode/ai/providers/amazon-bedrock/mantle/responses",
])
const defaults = { reasoningEffort: "medium", reasoningSummary: "auto" } as const

// OpenCode's default reasoning for GPT-5 on OpenAI Responses routes. The AI package sends none on its own.
export const Plugin = define({
  id: "opencode.prompt.reasoning",
  effect: Effect.fn("ReasoningPlugin")(function* (ctx) {
    const models = yield* Model.Service
    const hook = (event: SessionRequest) =>
      Effect.gen(function* () {
        const model = yield* models.get(event.model.providerID, event.model.id)
        if (!model || !responses.has(model.package ?? "") || !isGPT5Reasoning(model.modelID)) return
        const variant = model.variants.find((item) => item.id === event.model.variant)
        for (const key of ["reasoningEffort", "reasoningSummary"] as const) {
          if (event.options[key] !== undefined) continue
          if (model.settings?.[key] !== undefined || variant?.settings?.[key] !== undefined) continue
          event.options[key] = defaults[key]
        }
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
    yield* ctx.session.hook("title", hook)
  }),
} satisfies PluginInternal.InternalPlugin)

function isGPT5Reasoning(modelID: string) {
  const id = modelID.toLowerCase()
  return id.includes("gpt-5") && !id.includes("gpt-5-chat") && !id.includes("gpt-5-pro")
}
