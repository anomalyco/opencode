// Tokenize a free-form string into lowercase alphanumeric runs.
//
// Punctuation (`.`, `-`, `/`, `:`, quotes, etc.) becomes a separator, and each
// contiguous run of Unicode letters/numbers/underscore becomes one token.
// `\p{L}` includes CJK letters for non-latin recall. This mirrors the
// tokenization MiMo fed to SQLite FTS5 so query/body see the same token forms
// (e.g. `T5.3` -> `t5`, `3`; `postgres://host:5433` -> `postgres`, `host`, `5433`).
export function tokenize(raw: string): string[] {
  return (
    raw
      .toLowerCase()
      .match(/[\p{L}\p{N}_]+/gu)
      ?.filter(Boolean) ?? []
  )
}

/** Unique query tokens, preserving first-seen order. */
export function queryTokens(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tokenize(raw)) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
