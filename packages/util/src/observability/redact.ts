// Values that reach the log through provider errors, request spans, and tool metadata can carry a
// live credential. Redact the credential shape, not the whole value, so a log line stays useful for
// support while the secret never lands on disk.
const AUTHORIZATION = /(["']?authorization["']?\s*[:=]\s*["']?bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
const BEARER = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi
const PREFIXED_KEY = /\b(xpl|sk|pk|ghp|gho|ghs|ghu|ghr|glpat|gldt|xox[abprs])[-_][A-Za-z0-9_-]{16,}/g

// Keeps the recognizable prefix (for example `xpl-`) so a reader can still tell which credential
// leaked without being able to use it.
export function redact(input: string) {
  return input
    .replace(AUTHORIZATION, "$1[redacted]")
    .replace(BEARER, "$1[redacted]")
    .replace(PREFIXED_KEY, "$1-[redacted]")
}
