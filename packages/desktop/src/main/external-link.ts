const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

export function isSafeExternalLink(url: string) {
  try {
    const parsed = new URL(url)
    return ALLOWED_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}
