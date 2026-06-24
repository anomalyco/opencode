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
  const key = readXaiApiKeyRaw()
  if (!key) {
    throw new Error(
      "XAI_API_KEY is not set.\n\nCreate a key at https://console.x.ai then run:\n  export XAI_API_KEY=\"xai-…\"",
    )
  }
  validateXaiApiKey(key)
  return key
}

function readXaiApiKeyRaw() {
  return (process.env.XAI_API_KEY ?? "").trim().replace(/\r/g, "").replace(/\n/g, "")
}

function validateXaiApiKey(key: string) {
  if (PLACEHOLDER_KEYS.has(key) || PLACEHOLDER_KEYS.has(key.toLowerCase())) {
    throw new Error("XAI_API_KEY looks like a placeholder — use a real key from https://console.x.ai")
  }
  if (/\s/.test(key)) {
    throw new Error(
      "XAI_API_KEY contains whitespace — re-export it on one line: export XAI_API_KEY='xai-…'",
    )
  }
  if (key.length < 70) {
    throw new Error(
      `XAI_API_KEY looks truncated (${key.length} chars) — copy the full key from https://console.x.ai`,
    )
  }
}

export function xaiApiKeyStatus() {
  const key = readXaiApiKeyRaw()
  if (!key) {
    return {
      ok: false as const,
      reason: "XAI_API_KEY is not set",
    }
  }
  try {
    validateXaiApiKey(key)
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
  return { ok: true as const, key }
}
