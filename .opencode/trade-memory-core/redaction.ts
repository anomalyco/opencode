const secretPatterns = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
]

export function redactSecrets(input: string) {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), input)
}
