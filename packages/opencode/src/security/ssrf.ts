const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "169.254.170.2",
])

function isPrivateIP(hostname: string): boolean {
  const parts = hostname.split(".").map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function isLoopback(hostname: string): boolean {
  if (hostname === "localhost") return true
  const parts = hostname.split(".").map(Number)
  return parts.length === 4 && parts[0] === 127
}

export function validateProviderURL(
  url: string,
  opts: { allowLocalhost?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: "Invalid URL" }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `Unsupported protocol: ${parsed.protocol}` }
  }

  const hostname = parsed.hostname

  if (hostname.includes("..") || hostname.includes("\0")) {
    return { ok: false, reason: "Invalid hostname" }
  }

  if (METADATA_HOSTS.has(hostname)) {
    return { ok: false, reason: "Cloud metadata endpoint blocked" }
  }

  if (isLoopback(hostname)) {
    if (!opts.allowLocalhost) {
      return { ok: false, reason: "Localhost not permitted in production" }
    }
    return { ok: true }
  }

  if (isPrivateIP(hostname)) {
    return { ok: false, reason: "Private IP range blocked" }
  }

  return { ok: true }
}
