import { generateText } from "ai"
import { buildSystemPrompt, ERR_ON_BLOCK_SUFFIX, parseVerdict } from "../prompt"
import type { ClassifierInput, ClassifierProvider } from "../types"

/** Whatever `generateText` accepts as `model` — avoids pinning a provider-spec version. */
type LanguageModel = Parameters<typeof generateText>[0]["model"]

/** Render the reasoning-blind transcript + the action under evaluation, last. */
function renderUserPrompt(input: ClassifierInput): string {
  const lines: string[] = []
  for (const e of input.transcript) {
    if (e.role === "user") lines.push(`User: ${e.text}`)
    else lines.push(`${e.tool} ${JSON.stringify(e.input)}`)
  }
  lines.push(`${input.action.tool} ${JSON.stringify(input.action.input)}`)
  return `<transcript>\n${lines.join("\n")}\n</transcript>${ERR_ON_BLOCK_SUFFIX}`
}

/**
 * Default backend: classify with the user's own configured model via the AI SDK.
 * Single-pass (`<block>yes|no</block>`). Fails closed — any error or unparseable
 * response returns `unavailable: true` so the caller falls back to `ask`.
 */
export function ownModelProvider(model: LanguageModel, label: string): ClassifierProvider {
  return {
    async classify(input, signal) {
      try {
        const res = await generateText({
          model,
          system: buildSystemPrompt(input.policy),
          messages: [{ role: "user", content: renderUserPrompt(input) }],
          temperature: 0,
          maxOutputTokens: 256,
          abortSignal: signal,
        })
        const parsed = parseVerdict(res.text)
        if (!parsed)
          return { shouldBlock: true, unavailable: true, reason: "Classifier response unparseable", model: label }
        return { shouldBlock: parsed.shouldBlock, reason: parsed.reason, model: label }
      } catch (e) {
        return {
          shouldBlock: true,
          unavailable: true,
          reason: e instanceof Error ? e.message : "Classifier unavailable",
          model: label,
        }
      }
    },
  }
}
