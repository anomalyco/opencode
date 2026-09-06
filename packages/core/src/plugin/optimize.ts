export * as OptimizePlugin from "./optimize.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import { Model } from "@opencode-ai/schema/model"
import { Effect } from "effect"
import { SessionSystemPrompt } from "../session/system-prompt.js"

import PROMPT_GPT from "./system-prompt/gpt.txt"
import PROMPT_ASTRA from "./system-prompt/gpt-astra.txt"
import PROMPT_KIMI from "./system-prompt/kimi.txt"
import PROMPT_META from "./system-prompt/meta.txt"
import PROMPT_TRINITY from "./system-prompt/trinity.txt"

export const OpenAIPlugin = make("openai", (model, tools) => {
  const ids = [model.id, model.modelID, model.family].join(" ").toLowerCase()
  if (!ids.includes("gpt")) return undefined
  delete tools.grep
  delete tools.glob
  return ids.includes("gpt-6") ? PROMPT_ASTRA : PROMPT_GPT
})

export const AnthropicPlugin = make("anthropic", (model, tools) => {
  const ids = [model.id, model.modelID, model.family].join(" ").toLowerCase()
  if (!ids.includes("claude")) return undefined
  delete tools.grep
  delete tools.glob
  return undefined
})

export const KimiPlugin = make("kimi", (model) => (model.id.toLowerCase().includes("kimi") ? PROMPT_KIMI : undefined))
export const ArceePlugin = make("arcee", (model) =>
  model.id.toLowerCase().includes("trinity") ? PROMPT_TRINITY : undefined,
)
export const MetaPlugin = make("meta", (model) => {
  if (!model.id.toLowerCase().includes("muse")) return undefined
  return PROMPT_META.replaceAll("{{MODEL_NAME}}", model.name)
})

export const Plugins = [OpenAIPlugin, AnthropicPlugin, KimiPlugin, ArceePlugin, MetaPlugin] as const

function make(
  id: string,
  optimize: (model: Model.Info, tools: SessionHooks["context"]["tools"]) => string | undefined,
) {
  return define({
    id: `opencode.optimize.${id}`,
    effect: Effect.fn(`OptimizePlugin.${id}`)(function* (ctx) {
      yield* ctx.session.hook("context", (event) =>
        Effect.gen(function* () {
          const model =
            (yield* ctx.catalog.model.list()).data.find(
              (model) => model.providerID === event.model.providerID && model.id === event.model.id,
            ) ?? Model.Info.default(event.model.providerID, event.model.id)
          // Curate tools before rendering their guidance, including for agents with a custom system prompt.
          const template = optimize(model, event.tools)
          if (!template) return
          if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return
          const system = event.system[0]
          if (!system) return
          event.system[0] = { ...system, text: SessionSystemPrompt.render(template, Object.keys(event.tools)) }
        }).pipe(Effect.catch(() => Effect.void)),
      )
    }),
  })
}
