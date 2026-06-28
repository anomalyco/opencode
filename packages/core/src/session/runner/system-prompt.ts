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
  if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) return normalize(PROMPT_BEAST)
  if (id.includes("gpt")) {
    if (id.includes("codex")) return normalize(PROMPT_CODEX)
    return normalize(PROMPT_GPT)
  }
  if (id.includes("gemini-")) return normalize(PROMPT_GEMINI)
  if (id.includes("claude")) return normalize(PROMPT_ANTHROPIC)
  if (id.includes("trinity")) return normalize(PROMPT_TRINITY)
  if (id.includes("kimi")) return normalize(PROMPT_KIMI)
  return normalize(PROMPT_DEFAULT)
}

function normalize(prompt: string) {
  return prompt.replaceAll("\r\n", "\n")
}
