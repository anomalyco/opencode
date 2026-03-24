export type ParsedTheme = {
  $schema?: string
  defs?: Record<string, string | number>
  theme: Record<string, unknown>
}

const required = ["primary", "secondary", "accent", "text", "textMuted", "background"] as const

export function parseTheme(input: unknown): ParsedTheme | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return

  const json = input as Record<string, unknown>
  if (!json.theme || typeof json.theme !== "object" || Array.isArray(json.theme)) return

  const theme = json.theme as Record<string, unknown>
  if (required.some((key) => theme[key] === undefined)) return

  return input as ParsedTheme
}
