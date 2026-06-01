export const MODEL_AUTHOR_OVERRIDES = [{ model: "big-pickle", author: "opencode" }] as const
export const MODEL_AUTHOR_RULES = [
  { match: "claude", author: "anthropic" },
  { match: "gemini", author: "google" },
  { match: "deepseek", author: "deepseek" },
  { match: "glm", author: "zhipu" },
  { match: "gpt", author: "openai" },
  { match: "grok", author: "xai" },
  { match: "hy3", author: "tencent" },
  { match: "kimi", author: "moonshot" },
  { match: "mimo", author: "xiaomi" },
  { match: "minimax", author: "minimax" },
  { match: "nemotron", author: "nvidia" },
  { match: "qwen", author: "qwen" },
] as const
export const EXCLUDED_MODELS = new Set(["alpha-gpt-next"])

export function normalizeInferenceModel(value: string | undefined) {
  return (value || "unknown").replace(/(-free|:global)+$/, "") || "unknown"
}

export function modelAuthor(value: string | undefined) {
  const model = normalizeInferenceModel(value).toLowerCase()
  if (EXCLUDED_MODELS.has(model)) return undefined

  const override = MODEL_AUTHOR_OVERRIDES.find((item) => item.model === model)
  if (override) return override.author

  return MODEL_AUTHOR_RULES.find((item) => model.includes(item.match))?.author ?? "unknown"
}
