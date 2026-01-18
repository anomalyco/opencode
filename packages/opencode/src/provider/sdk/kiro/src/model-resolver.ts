const HIDDEN_MODELS: Record<string, string> = {
  "claude-3.7-sonnet": "CLAUDE_3_7_SONNET_20250219_V1_0",
  "claude-3-7-sonnet": "CLAUDE_3_7_SONNET_20250219_V1_0",
}

export function normalizeModelName(name: string): string {
  // Convert model names like claude-sonnet-4-5 → claude-sonnet-4.5
  // or claude-haiku-4-5-20251001 → claude-haiku-4.5
  const normalized = name
    .toLowerCase()
    .replace(/-(\d+)-(\d{1,2})(?:-(?:\d{8}|latest))?$/, "-$1.$2") // 4-5 → 4.5
    .replace(/-(\d+)(?:-\d{8})?$/, "-$1") // 4-20250514 → 4

  return HIDDEN_MODELS[normalized] ?? normalized
}
