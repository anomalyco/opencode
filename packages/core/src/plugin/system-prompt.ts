export * as SystemPromptPlugin from "./system-prompt.js"

import { SystemPart } from "@opencode-ai/ai"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Model } from "@opencode-ai/schema/model"
import { Effect } from "effect"
import { SessionSystemPrompt } from "../session/system-prompt.js"

import PROMPT_GPT from "./system-prompt/gpt.txt"
import PROMPT_ASTRA from "./system-prompt/gpt-astra.txt"
import PROMPT_KIMI from "./system-prompt/kimi.txt"
import PROMPT_META from "./system-prompt/meta.txt"
import PROMPT_TRINITY from "./system-prompt/trinity.txt"

export const OpenAIPlugin = make(
  "openai",
  (model) => {
    if (!model.id.toLowerCase().includes("gpt")) return

    if (model.id.toLowerCase().includes("gpt-6")) return PROMPT_ASTRA

    return PROMPT_GPT
  },
  { operation: "replace" },
)

export const KimiPlugin = make("kimi", (model) => (model.id.toLowerCase().includes("kimi") ? PROMPT_KIMI : undefined), {
  operation: "replace",
})
export const ArceePlugin = make(
  "arcee",
  (model) => (model.id.toLowerCase().includes("trinity") ? PROMPT_TRINITY : undefined),
  { operation: "replace" },
)
export const MetaPlugin = make(
  "meta",
  (model) => {
    if (!model.id.toLowerCase().includes("muse")) return
    return PROMPT_META.replaceAll("{{MODEL_NAME}}", model.name)
  },
  { operation: "replace" },
)

export const Plugins = [OpenAIPlugin, KimiPlugin, ArceePlugin, MetaPlugin] as const

function make(
  id: string,
  getPrompt: (model: Model.Info) => string | undefined,
  options: { operation: "replace" | "append" },
) {
  return define({
    id: `opencode.prompt.${id}`,
    effect: Effect.fn(`SystemPromptPlugin.${id}`)(function* (ctx) {
      yield* ctx.session.hook("context", (event) =>
        Effect.gen(function* () {
          if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return
          const system = event.system[0]
          if (!system) return
          const model = (yield* ctx.catalog.model.list()).data.find(
            (model) => model.providerID === event.model.providerID && model.id === event.model.id,
          )
          const template = getPrompt(model ?? Model.Info.default(event.model.providerID, event.model.id))
          if (!template) return
          const prompt = SessionSystemPrompt.render(template, Object.keys(event.tools))
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
