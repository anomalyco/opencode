export * as SystemPromptPlugin from "./system-prompt.js"

import { SystemPart } from "@opencode-ai/ai"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"

import PROMPT_ANTHROPIC from "./system-prompt/anthropic.txt"
import PROMPT_GPT from "./system-prompt/gpt-extension.txt"
import PROMPT_KIMI from "./system-prompt/kimi.txt"
import PROMPT_META from "./system-prompt/meta.txt"
import PROMPT_TRINITY from "./system-prompt/trinity.txt"

export const OpenAIPlugin = make("openai", (id) => (id.includes("gpt") ? PROMPT_GPT : undefined), {
  operation: "append",
})

export const AnthropicPlugin = make("anthropic", (id) => (id.includes("claude") ? PROMPT_ANTHROPIC : undefined), {
  operation: "replace",
})
export const KimiPlugin = make("kimi", (id) => (id.includes("kimi") ? PROMPT_KIMI : undefined), {
  operation: "replace",
})
export const ArceePlugin = make("arcee", (id) => (id.includes("trinity") ? PROMPT_TRINITY : undefined), {
  operation: "replace",
})
export const MetaPlugin = make(
  "meta",
  (id) => {
    if (!id.includes("muse")) return
    const name = id.includes("muse-glimmer") ? "Muse Glimmer" : "Muse Spark"
    return PROMPT_META.replaceAll("{{MODEL_NAME}}", name)
  },
  { operation: "replace" },
)

export const Plugins = [OpenAIPlugin, AnthropicPlugin, KimiPlugin, ArceePlugin, MetaPlugin] as const

function make(
  id: string,
  getPrompt: (modelID: string) => string | undefined,
  options: { operation: "replace" | "append" },
) {
  return define({
    id: `opencode.prompt.${id}`,
    effect: Effect.fn(`SystemPromptPlugin.${id}`)(function* (ctx) {
      yield* ctx.session.hook("context", (event) =>
        Effect.gen(function* () {
          if (event.purpose === "title") return
          if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return
          const system = event.system[0]
          if (!system) return
          const model = (yield* ctx.catalog.model.list()).data.find(
            (model) => model.providerID === event.model.providerID && model.id === event.model.id,
          )
          const prompt = getPrompt(`${model?.modelID ?? event.model.id} ${model?.family ?? ""}`.toLowerCase())
          if (!prompt) return
          if (options.operation === "append") {
            event.system.splice(1, 0, SystemPart.make(prompt))
            return
          }
          event.system[0] = { ...system, text: prompt }
        }).pipe(Effect.catch(() => Effect.void)),
      )
    }),
  })
}
