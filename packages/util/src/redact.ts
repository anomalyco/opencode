export const REDACTED = "<redacted>"

const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const PEM_HEADER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^\s/@"'`<>\\]*:[^\s/@"'`<>\\]*)@/gi
const BEARER_TOKEN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}(?![A-Za-z0-9._~+/=-])/gi

const TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}\b/g,
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{20,}\b/g,
  /(?<![A-Za-z0-9_-])sk-(?:ant-[A-Za-z0-9_-]{20,}|[A-Za-z0-9][A-Za-z0-9_-]{20,})\b/g,
  /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{20,}\b/g,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /(?<![A-Za-z0-9_-])xox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}\b/g,
  /(?<![A-Za-z0-9_-])pypi-[A-Za-z0-9_-]{20,}\b/g,
]

/** Redacts known credential token formats, PEM private keys, and URL userinfo (`user:pass@`) from text. */
export function redactSecrets(input: string): string {
  if (!input) return input
  let output = input
  if (output.includes("PRIVATE KEY")) {
    output = output.replace(PEM_BLOCK, REDACTED).replace(PEM_HEADER, REDACTED)
  }
  // Redact URL userinfo before token patterns so `scheme://user:<token>@host` collapses to `scheme://<redacted>@host`.
  if (output.includes("://") && output.includes("@")) {
    output = output.replace(URL_USERINFO, `$1${REDACTED}@`)
  }
  if (output.includes("earer") || output.includes("EARER")) {
    output = output.replace(BEARER_TOKEN, `$1${REDACTED}`)
  }
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, REDACTED)
  }
  return output
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Recursively redacts strings inside arrays and plain objects, preserving object identity when nothing changes. */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T
  if (Array.isArray(value)) {
    const next = value.map((item) => redactValue(item))
    return next.some((item, index) => item !== value[index]) ? (next as T) : value
  }
  if (!isPlainObject(value)) return value
  const entries = Object.entries(value)
  const next = entries.map(([key, item]) => [key, redactValue(item)] as const)
  return next.some(([, item], index) => item !== entries[index][1]) ? (Object.fromEntries(next) as T) : value
}
