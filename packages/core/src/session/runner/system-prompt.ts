export * as SessionRunnerSystemPrompt from "./system-prompt"

import type { Model } from "@opencode-ai/llm"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"

export function provider(model: Model) {
  const id = model.id.toLowerCase()
  if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) return PROMPT_BEAST
  if (id.includes("gpt")) {
    if (id.includes("codex")) return PROMPT_CODEX
    return PROMPT_GPT
  }
  if (id.includes("gemini-")) return PROMPT_GEMINI
  if (id.includes("claude")) return PROMPT_ANTHROPIC
  if (id.includes("trinity")) return PROMPT_TRINITY
  if (id.includes("kimi")) return PROMPT_KIMI
  return PROMPT_DEFAULT
}
