// Pure helpers shared between the runtime validator and the eval script
// (packages/opencode/script/eval-validator.ts). Keep this module free of
// imports so the eval stays hermetic.

// Strict verdict parse: first non-empty line after stripping think blocks.
// Anything else is invalid and the caller degrades to the human flow.
export function parseVerdict(text: string) {
  const line = text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (!line) return undefined
  const upper = line.toUpperCase()
  if (upper === "ALLOW") return { verdict: "allow" } as const
  if (upper.startsWith("DENY ")) {
    const reason = line.slice(5).trim()
    return reason ? ({ verdict: "deny", reason } as const) : undefined
  }
  if (upper.startsWith("UNCERTAIN ")) {
    const reason = line.slice(10).trim()
    return reason ? ({ verdict: "uncertain", reason } as const) : undefined
  }
  return undefined
}

// User message sent to the validator model; the eval script must replay this
// exact format so results match production behavior.
export function buildPrompt(
  input: {
    readonly permission: string
    readonly patterns: readonly string[]
    readonly metadata: Record<string, unknown>
  },
  summary?: string,
) {
  return [
    `Permission: ${input.permission}`,
    `Patterns: ${input.patterns.join(", ")}`,
    `Metadata: ${JSON.stringify(input.metadata)}`,
    "",
    "Session summary:",
    summary ?? "(none)",
  ].join("\n")
}
