// forked-from: packages/opencode/src/session/system.ts@ab6c8a6
// Only `provider(model)` (per-model prompt selection) is kept. It takes the model id and provider id instead of an
// AI-SDK Provider.Model, and drops the Skill/MCP/Location services (2,471-module graph). Texts are path-imported.
import PROMPT_ANTHROPIC from "@/session/prompt/anthropic.txt"
import PROMPT_DEFAULT from "@/session/prompt/default.txt"
import PROMPT_BEAST from "@/session/prompt/beast.txt"
import PROMPT_GEMINI from "@/session/prompt/gemini.txt"
import PROMPT_GPT from "@/session/prompt/gpt.txt"
import PROMPT_ASTRA from "@/session/prompt/gpt-astra.txt"
import PROMPT_KIMI from "@/session/prompt/kimi.txt"
import PROMPT_META from "@/session/prompt/meta.txt"
import PROMPT_CODEX from "@/session/prompt/codex.txt"
import PROMPT_TRINITY from "@/session/prompt/trinity.txt"

export function provider(model: { id: string; providerID: string }) {
  if (model.id.includes("muse")) {
    const name = model.id.includes("muse-glimmer") ? "Muse Glimmer" : "Muse Spark"
    return [PROMPT_META.replaceAll("{{MODEL_NAME}}", name)]
  }
  if (model.id.includes("gpt-4") || model.id.includes("o1") || model.id.includes("o3")) return [PROMPT_BEAST]
  if (model.id.includes("gpt")) {
    if (model.id.includes("gpt-6")) return [PROMPT_ASTRA]
    if (model.id.includes("codex")) return [PROMPT_CODEX]
    return [PROMPT_GPT]
  }
  if (model.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (
    model.id.toLowerCase().includes("kimi") ||
    ["kimi-for-coding", "moonshotai", "moonshotai-cn"].includes(model.providerID)
  )
    return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}
