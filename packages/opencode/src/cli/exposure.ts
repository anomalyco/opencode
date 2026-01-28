type Decision = "allow" | "confirm" | "deny"

function normalizeHost(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1).toLowerCase()
  return trimmed.toLowerCase()
}

function isLoopbackHost(hostname: string) {
  const host = normalizeHost(hostname)
  if (!host) return true
  return host === "127.0.0.1" || host === "localhost" || host === "::1"
}

export function exposureGuardDecision(input: {
  hostname: string
  passwordSet: boolean
  yes?: boolean
  isTTY: boolean
}): Decision {
  if (input.passwordSet) return "allow"
  if (isLoopbackHost(input.hostname)) return "allow"
  if (input.yes) return "allow"
  return input.isTTY ? "confirm" : "deny"
}

