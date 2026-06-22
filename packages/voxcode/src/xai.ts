const PLACEHOLDER_KEYS = new Set([
  "…",
  "...",
  "xxx",
  "your-key",
  "your xai voice key",
  "your xai key",
  "<your-key>",
])

export function requireXaiApiKey() {
  const key = process.env.XAI_API_KEY?.trim() ?? ""
  if (!key) {
    throw new Error(
      "XAI_API_KEY is not set.\n\nCreate a key at https://console.x.ai then run:\n  export XAI_API_KEY=\"xai-…\"",
    )
  }
  if (PLACEHOLDER_KEYS.has(key) || PLACEHOLDER_KEYS.has(key.toLowerCase())) {
    throw new Error("XAI_API_KEY looks like a placeholder — use a real key from https://console.x.ai")
  }
  if (key.length < 70) {
    throw new Error(
      `XAI_API_KEY looks truncated (${key.length} chars) — copy the full key from https://console.x.ai`,
    )
  }
  return key
}
