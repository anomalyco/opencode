export * as SystemPromptPlugin from "./system-prompt"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect } from "effect"

import PROMPT_DEFAULT from "../session/runner/prompt/default.txt"
import PROMPT_ANTHROPIC from "./system-prompt/anthropic.txt"
import PROMPT_BEAST from "./system-prompt/beast.txt"
import PROMPT_CODEX from "./system-prompt/codex.txt"
import PROMPT_GEMINI from "./system-prompt/gemini.txt"
import PROMPT_GPT from "./system-prompt/gpt.txt"
import PROMPT_KIMI from "./system-prompt/kimi.txt"
import PROMPT_TRINITY from "./system-prompt/trinity.txt"

const fallback = PROMPT_DEFAULT

export const Plugin = define({
  id: "opencode.system-prompt",
  effect: Effect.fn("SystemPromptPlugin.Plugin")(function* (ctx) {
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        if (event.system[0]?.text !== fallback) return
        event.system[0] = { ...event.system[0], text: prompt(event.model.id) }
      }),
    )
  }),
})

function prompt(modelID: string) {
  const id = modelID.toLowerCase()
  if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) return PROMPT_BEAST
  if (id.includes("gpt")) {
    if (id.includes("codex")) return PROMPT_CODEX
    return PROMPT_GPT
  }
  if (id.includes("gemini-")) return PROMPT_GEMINI
  if (id.includes("claude")) return PROMPT_ANTHROPIC
  if (id.includes("trinity")) return PROMPT_TRINITY
  if (id.includes("kimi")) return PROMPT_KIMI
  return fallback
}
