/**
 * Deterministic deny for clearly destructive commands — runs before the LLM classifier.
 * Returns a short reason when matched; undefined otherwise.
 */
export function destructiveReason(permission: string, patterns: readonly string[]): string | undefined {
  void permission
  for (const pattern of patterns) {
    const reason = matchDestructivePattern(pattern)
    if (reason) return reason
  }
  return undefined
}

function matchDestructivePattern(raw: string): string | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const lower = text.toLowerCase()

  // rm -rf / rm -fr / rm -r -f / rm --recursive --force (any flag order)
  if (/\brm\b/.test(lower)) {
    const window = lower.replace(/\s+/g, " ")
    const recursiveForce =
      /\brm\b(?:\s+-[a-z0-9]*)*\s+(-[a-z0-9]*r[a-z0-9]*f[a-z0-9]*|-[a-z0-9]*f[a-z0-9]*r[a-z0-9]*)\b/.test(window) ||
      (/\brm\b/.test(window) &&
        /(?:^|\s)-r(?:\s|$)|--recursive/.test(window) &&
        /(?:^|\s)-f(?:\s|$)|--force/.test(window))
    if (recursiveForce) return "Recursive force delete (rm -rf) is blocked"
  }

  if (/\bdrop\s+database\b/.test(lower)) return "DROP DATABASE is blocked"
  if (/\bdrop\s+schema\b/.test(lower) && /\bcascade\b/.test(lower)) return "DROP SCHEMA CASCADE is blocked"
  if (/\btruncate\s+table\b/.test(lower)) return "TRUNCATE TABLE is blocked"

  if (
    /\bgit\b/.test(lower) &&
    /\bpush\b/.test(lower) &&
    /(?:^|\s)(-f|--force|--force-with-lease)(?:\s|$)/.test(lower) &&
    /\b(main|master)\b/.test(lower)
  ) {
    return "Force-push to main/master is blocked"
  }

  if (/\bmkfs(\.|$|\s)/.test(lower)) return "Filesystem format (mkfs) is blocked"
  if (/\bdd\b/.test(lower) && /\bof\s*=\s*\/dev\//.test(lower)) return "dd write to device is blocked"

  return undefined
}
