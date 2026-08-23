import type { Provider } from "@/provider/provider"

export type Family = "muse" | "beast" | "codex" | "gpt" | "gemini" | "claude" | "trinity" | "kimi"

// One vendor-family ladder shared by the system-prompt selector
// (SystemPrompt.provider) and the tier vendor guard (SessionTier), so a new
// frontier family is added in exactly one place. Config-defined models may
// carry no upstream api id; fall back to the opencode model id.
export function family(model: Provider.Model): Family | undefined {
  const id = model.api.id ?? model.id ?? ""
  const lower = id.toLowerCase()
  if (id.includes("muse")) return "muse"
  if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) return "beast"
  if (id.includes("gpt")) return id.includes("codex") ? "codex" : "gpt"
  if (id.includes("gemini-")) return "gemini"
  if (id.includes("claude")) return "claude"
  if (lower.includes("trinity")) return "trinity"
  if (lower.includes("kimi")) return "kimi"
  if (["kimi-for-coding", "moonshotai", "moonshotai-cn"].includes(model.providerID)) return "kimi"
  return undefined
}

export * as ModelFamily from "./model-family"
