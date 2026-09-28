import { redactConfig } from "opencode/cli/cmd/debug/redact"

// The one redaction helper: secret-named keys, header values and credentialed URLs (opencode's redactConfig),
// plus every registered secret value wherever it appears in a string (logs, JSONL, stream-json).
const secrets = new Set<string>()
const secretName = /(?:api.?key|secret|password|passwd|token|authorization|cookie|credential|private.?key)/i

export function registerSecret(secret: string) {
  // Very short values would redact ordinary text; real keys and tokens are longer.
  if (secret.length >= 6) secrets.add(secret)
}

/** Env values whose NAME looks secret (`*_API_KEY`, `GITHUB_TOKEN`, `*_SECRET`, `*_PASSWORD`, …), 8+ chars. */
export function registerEnvSecrets(env: Record<string, string | undefined> = process.env) {
  Object.entries(env).forEach(([name, value]) => value && value.length >= 8 && secretName.test(name) && registerSecret(value))
}

export function redactText(text: string, list: readonly string[] = [...secrets]) {
  return list.filter(Boolean).reduce((result, secret) => result.replaceAll(secret, "***"), text)
}

export function redact(value: unknown): unknown {
  return scrub(redactConfig(value), [...secrets])
}

/** Userinfo and secret-named query values of a URL (`https://u:p@host/?api_key=…`), raw and decoded. */
export function urlSecrets(url: string) {
  if (!URL.canParse(url)) return []
  const parsed = new URL(url)
  const query = [...parsed.searchParams].filter((entry) => secretName.test(entry[0])).map((entry) => entry[1])
  const userinfo = [parsed.username, parsed.password].flatMap((part) => [part, decodeURIComponent(part)])
  return [...userinfo, ...query, ...query.map(encodeURIComponent)].filter(Boolean)
}

/** Values after secret-named flags: `--token abc`, `--api-key=abc`, `--password abc`. */
export function argSecrets(args: readonly string[]) {
  return args
    .flatMap((arg, index) => {
      const match = arg.match(/^--?([^=]+)(?:=(.*))?$/)
      if (!match || !secretName.test(match[1])) return []
      if (match[2] !== undefined) return [match[2]]
      const next = args[index + 1]
      return next !== undefined && !next.startsWith("-") ? [next] : []
    })
    .filter(Boolean)
}

export function redactUrl(url: string) {
  return redactText(url, [...urlSecrets(url), ...secrets])
}

export function redactArgs(args: readonly string[]) {
  const list = [...argSecrets(args), ...secrets]
  return args.map((arg) => redactText(arg, list))
}

function scrub(value: unknown, list: readonly string[]): unknown {
  if (typeof value === "string") return redactText(value, list)
  if (Array.isArray(value)) return value.map((item) => scrub(item, list))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map((entry) => [entry[0], scrub(entry[1], list)]))
}
