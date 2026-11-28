export const REDACTED = "<redacted>"

const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const PEM_HEADER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^\s/@"'`<>\\]*:[^\s/@"'`<>\\]*)@/gi
const BEARER_TOKEN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}(?![A-Za-z0-9._~+/=-])/gi

const TOKEN_RULES: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/github_pat_/, /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}\b/g],
  [/gh[pousr]_/, /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  [/npm_/, /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{20,}\b/g],
  [/sk-/, /(?<![A-Za-z0-9_-])sk-(?:ant-[A-Za-z0-9_-]{20,}|[A-Za-z0-9][A-Za-z0-9_-]{20,})\b/g],
  [/AIza/, /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{20,}\b/g],
  [/A[KS]IA/, /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  [/xox[baprs]-/, /(?<![A-Za-z0-9_-])xox[baprs]-[0-9A-Za-z-]{10,}\b/g],
  [/glpat-/, /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}\b/g],
  [/pypi-/, /(?<![A-Za-z0-9_-])pypi-[A-Za-z0-9_-]{20,}\b/g],
]

// Cheap single-pass pre-check covering every pattern below so clean log values skip the full regexes.
const SECRET_HINT =
  /PRIVATE KEY|:\/\/|(?:earer|EARER)\s|github_pat_|gh[pousr]_|npm_|sk-|AIza|A[KS]IA|xox[baprs]-|glpat-|pypi-/

const preRedacted = new WeakSet<object>()

/** Marks an object or array as already redacted so log formatting does not scan it a second time. */
export function markRedacted<T extends object>(value: T): T {
  preRedacted.add(value)
  return value
}

export function isRedacted(value: unknown): boolean {
  return typeof value === "object" && value !== null && preRedacted.has(value)
}

/** Redacts known credential token formats, PEM private keys, and URL userinfo (`user:pass@`) from text. */
export function redactSecrets(input: string): string {
  if (input.length < 6 || !SECRET_HINT.test(input)) return input
  let output = input
  if (output.length >= 27 && output.includes("PRIVATE KEY")) {
    output = output.replace(PEM_BLOCK, REDACTED).replace(PEM_HEADER, REDACTED)
  }
  // Redact URL userinfo before token patterns so `scheme://user:<token>@host` collapses to `scheme://<redacted>@host`.
  if (output.includes("://") && output.includes("@")) {
    output = output.replace(URL_USERINFO, `$1${REDACTED}@`)
  }
  if (output.length < 15) return output
  if (output.length >= 23 && (output.includes("earer") || output.includes("EARER"))) {
    output = output.replace(BEARER_TOKEN, `$1${REDACTED}`)
  }
  return TOKEN_RULES.reduce(
    (text, [hint, pattern]) => (hint.test(text) ? text.replace(pattern, REDACTED) : text),
    output,
  )
}
