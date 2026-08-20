export * as SystemPromptPlugin from "./system-prompt.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"

import PROMPT_ANTHROPIC from "./system-prompt/anthropic.txt"
import PROMPT_CODEX from "./system-prompt/codex.txt"
import PROMPT_GEMINI from "./system-prompt/gemini.txt"
import PROMPT_GPT from "./system-prompt/gpt.txt"
import PROMPT_KIMI from "./system-prompt/kimi.txt"
import PROMPT_META from "./system-prompt/meta.txt"
import PROMPT_TRINITY from "./system-prompt/trinity.txt"

export const OpenAIPlugin = make("openai", (id) => {
  if (id.includes("gpt")) {
    if (id.includes("codex")) return PROMPT_CODEX
    return PROMPT_GPT
  }
  if (id.includes("o1") || id.includes("o3")) return PROMPT_GPT
})

export const GooglePlugin = make("google", (id) => (id.includes("gemini-") ? PROMPT_GEMINI : undefined))
export const AnthropicPlugin = make("anthropic", (id) => (id.includes("claude") ? PROMPT_ANTHROPIC : undefined))
export const KimiPlugin = make("kimi", (id) => (id.includes("kimi") ? PROMPT_KIMI : undefined))
export const ArceePlugin = make("arcee", (id) => (id.includes("trinity") ? PROMPT_TRINITY : undefined))
export const MetaPlugin = make("meta", (id) => {
  if (!id.includes("muse")) return
  const name = id.includes("muse-glimmer") ? "Muse Glimmer" : "Muse Spark"
  return PROMPT_META.replaceAll("{{MODEL_NAME}}", name)
})

export const Plugins = [OpenAIPlugin, GooglePlugin, AnthropicPlugin, KimiPlugin, ArceePlugin, MetaPlugin] as const

function make(id: string, select: (modelID: string) => string | undefined) {
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
          const prompt = select(`${model?.modelID ?? event.model.id} ${model?.family ?? ""}`.toLowerCase())
          if (!prompt) return
          event.system[0] = { ...system, text: prompt }
        }).pipe(Effect.catch(() => Effect.void)),
      )
    }),
  })
}
