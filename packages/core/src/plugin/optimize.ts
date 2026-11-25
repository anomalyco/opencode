export * as OptimizePlugin from "./optimize.js"

import { define, type Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { SessionSystemPrompt } from "../session/system-prompt.js"

import PROMPT_GPT from "./system-prompt/gpt.txt"
import PROMPT_GPT_6_2 from "./system-prompt/gpt-6.2.txt"
import PROMPT_ASTRA from "./system-prompt/gpt-astra.txt"
import PROMPT_KIMI from "./system-prompt/kimi.txt"
import PROMPT_META from "./system-prompt/meta.txt"
import PROMPT_TRINITY from "./system-prompt/trinity.txt"
import PROMPT_ANTHROPIC from "./system-prompt/anthropic.txt"

const LEGACY_GPT = /gpt-(?:35|[1-5](?:[.-]\d+)?|6(?:[.-][01])?|oss)(?![.\d]|-\d{1,2}\b)/

export const OpenAIPlugin = make("opencode.prompt.openai", (model) => {
  const id = model.id.toLowerCase()
  if (!id.includes("gpt")) return undefined
  if (LEGACY_GPT.test(id)) return id.includes("astra") ? PROMPT_ASTRA : PROMPT_GPT
  // Derived from Codex's prompts, where GPT-6.2 Sol and Astra share the same core instructions.
  return PROMPT_GPT_6_2
})

export const AnthropicPlugin = make(
  "opencode.prompt.anthropic",
  (model) => {
    const id = model.id.toLowerCase()
    if (!id.includes("claude")) return undefined
    return PROMPT_ANTHROPIC
  },
  "append",
)

export const KimiPlugin = make("opencode.prompt.kimi", (model) =>
  model.id.toLowerCase().includes("kimi") ? PROMPT_KIMI : undefined,
)
export const ArceePlugin = make("opencode.prompt.arcee", (model) =>
  model.id.toLowerCase().includes("trinity") ? PROMPT_TRINITY : undefined,
)
export const MetaPlugin = make("opencode.prompt.meta", (model) => {
  if (!model.id.toLowerCase().includes("muse")) return undefined
  return PROMPT_META.replaceAll("{{MODEL_NAME}}", model.name)
})

export const Plugins = [OpenAIPlugin, AnthropicPlugin, KimiPlugin, ArceePlugin, MetaPlugin] as const

const models = new WeakMap<SessionHooks["context"], Model.Info>()

export const resolveModel = (ctx: Context, event: SessionHooks["context"]) =>
  Effect.gen(function* () {
    const cached = models.get(event)
    if (cached?.providerID === event.model.providerID && cached.id === event.model.id) return cached
    const model: Model.Info =
      (yield* ctx.model.list()).data.find(
        (model) => model.providerID === event.model.providerID && model.id === event.model.id,
      ) ?? Model.Info.default(event.model.providerID, event.model.id)
    models.set(event, model)
    return model
  })

function make(
  id: string,
  optimize: (model: Model.Info) => string | undefined,
  mode: "override" | "append" = "override",
) {
  return define({
    id,
    effect: Effect.fn(`OptimizePlugin.${id}`)(function* (ctx) {
      const hook = (event: SessionHooks["context"]) =>
        Effect.gen(function* () {
          const model = yield* resolveModel(ctx, event)
          const template = optimize(model)
          if (!template) return
          if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return
          const system = event.system[0]
          if (!system) return
          const rendered = SessionSystemPrompt.render(template, Object.keys(event.tools))
          const text = mode === "append" ? `${system.text}\n\n${rendered}` : rendered
          event.system[0] = { ...system, text }
        }).pipe(Effect.catch(() => Effect.void))
      yield* ctx.session.hook("context", hook)
      yield* ctx.session.hook("compaction", hook)
      yield* ctx.session.hook("generate", hook)
    }),
  })
}
