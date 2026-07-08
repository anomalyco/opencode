const schemeOf = (input: string): string | undefined => {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input.trim())
  return match ? match[1].toLowerCase() : undefined
}

// A non-http(s) scheme address (e.g. `my-helper://…`) is handed to the OS for a local
// helper to broker, not connected to directly.
export function isExternalSchemeAddress(input: string): boolean {
  const scheme = schemeOf(input)
  return !!scheme && scheme !== "http" && scheme !== "https"
}

// Schemes that must never be handed to the OS launcher (can leak local files/credentials
// or execute). A configured allowlist would be stricter; this denylist is the safe floor.
const UNSAFE_LAUNCH_SCHEMES = new Set(["file", "smb", "javascript", "data", "vbscript", "chrome", "about"])

export function isSafeBrokerScheme(input: string): boolean {
  const scheme = schemeOf(input)
  return !!scheme && scheme !== "http" && scheme !== "https" && !UNSAFE_LAUNCH_SCHEMES.has(scheme)
}
