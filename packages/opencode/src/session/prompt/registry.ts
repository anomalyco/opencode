// Central registry of system prompts keyed by provider family name.
// Each model can reference a prompt by name (e.g. "gemini", "anthropic") via its
// `systemPrompt` field. When no explicit prompt is set, `SystemPrompt.provider()`
// in system.ts falls back to pattern-matching on the model API id.
// Adding a new prompt: import the .txt file and add an entry to PROMPTS below.
// The Zod schema (`SystemPromptSchema`) is derived automatically from the registry keys.

import z from "zod"

import PROMPT_ANTHROPIC from "./anthropic.txt"
import PROMPT_BEAST from "./beast.txt"
import PROMPT_CODEX from "./codex_header.txt"
import PROMPT_GEMINI from "./gemini.txt"
import PROMPT_QWEN from "./qwen.txt"
import PROMPT_TRINITY from "./trinity.txt"

export const PROMPTS = {
  anthropic: PROMPT_ANTHROPIC,
  beast: PROMPT_BEAST,
  codex: PROMPT_CODEX,
  gemini: PROMPT_GEMINI,
  qwen: PROMPT_QWEN,
  trinity: PROMPT_TRINITY,
} as const

const promptNames = Object.keys(PROMPTS) as [SystemPromptName, ...SystemPromptName[]]

export type SystemPromptName = keyof typeof PROMPTS

export const SystemPromptSchema = z.enum(promptNames).optional()
