// ---------------------------------------------------------------------------
// Canonical identity — "platform:platformId" format
// ---------------------------------------------------------------------------

/**
 * Build a canonical ID from platform and platform-specific ID.
 * Format: "platform:platformId" — e.g. "telegram:123456", "discord:789012"
 */
export function buildCanonicalId(platform: string, platformId: string): string {
  return `${platform}:${platformId}`
}

/**
 * Parse a canonical ID back into platform and platformId.
 * Returns [platform, platformId] or null if format is invalid.
 */
export function parseCanonicalId(canonical: string): [platform: string, platformId: string] | null {
  const idx = canonical.indexOf(":")
  if (idx <= 0 || idx >= canonical.length - 1) return null
  return [canonical.slice(0, idx), canonical.slice(idx + 1)]
}

/**
 * Check if a sender matches an allowed identifier.
 * Supports:
 *   - "123456" matches platformId directly
 *   - "@alice" matches username
 *   - "telegram:123456" matches canonical ID
 */
export function matchAllowed(
  sender: { platformId: string; canonicalId: string; username?: string },
  allowed: string
): boolean {
  if (allowed.startsWith("@")) {
    return sender.username === allowed.slice(1)
  }
  if (allowed.includes(":")) {
    return sender.canonicalId === allowed
  }
  return sender.platformId === allowed
}
