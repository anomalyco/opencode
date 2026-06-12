export type RedactionResult = {
  text: string
  redactions: string[]
}

type Rule = {
  name: string
  pattern: RegExp
  replace: (input: string) => string
}

const SENSITIVE_KEYS = new Set(["token", "api_key", "secret", "password", "access_token", "refresh_token", "client_secret"])

const RULES: Rule[] = [
  {
    name: "bearer-token",
    pattern: /Bearer\s+[A-Za-z0-9._\-]{10,}/g,
    replace: () => "Bearer [REDACTED_TOKEN]",
  },
  {
    name: "env-secret",
    pattern: /(^|[\s,(])([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^\s]+)/gim,
    replace: (input) => {
      const prefix = input.match(/^[\s,(]*/)?.[0] ?? ""
      const secret = input.slice(prefix.length)
      return `${prefix}${secret.split("=")[0]}=[REDACTED_SECRET]`
    },
  },
  {
    name: "query-secret",
    pattern: /([?&#;])(token|api_key|api-key|secret|password|access_token|refresh_token|client_secret)=([^&#\s;]+)/gi,
    replace: (input) => input.replace(/([?&#;])([A-Za-z0-9_-]+)=([^&#\s;]+)/i, (_, prefix: string, key: string) => {
      return `${prefix}${key}=[REDACTED_SECRET]`
    }),
  },
  {
    name: "password-field",
    pattern: /\b(password|passwd|pwd)\s*:\s*[^\s]+/gi,
    replace: (input) => `${input.split(":")[0]}: [REDACTED_SECRET]`,
  },
  {
    name: "account-login",
    pattern: /\b(account\s+login|login|account)\s+([0-9]{5,})\b/gi,
    replace: (input) => `${input.replace(/[0-9]{5,}/g, "[REDACTED_ACCOUNT]")}`,
  },
]

export function redactEaLabText(input: string): RedactionResult {
  return RULES.reduce(
    (state, rule) => {
      const matches = state.text.match(rule.pattern) ?? []
      if (!matches.length) return state
      return {
        text: state.text.replace(rule.pattern, (value) => rule.replace(value)),
        redactions: [...state.redactions, ...matches.map(() => rule.name)],
      }
    },
    { text: input, redactions: [] as string[] },
  )
}

export function redactEaLabJson(input: string, field: string) {
  const value = input.trim()
  if (!value) throw new Error(`${field} must not be empty`)
  const decoded = JSON.parse(value) as unknown
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error(`${field} must be a JSON object`)
  return JSON.stringify(redactJsonValue(decoded))
}

function redactJsonValue(input: unknown): unknown {
  if (typeof input === "string") return redactEaLabText(input).text
  if (Array.isArray(input)) return input.map(redactJsonValue)
  if (!input || typeof input !== "object") return input
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, isSensitiveKey(key) ? "[REDACTED_SECRET]" : redactJsonValue(value)]),
  )
}

function isSensitiveKey(input: string) {
  return SENSITIVE_KEYS.has(input.trim().toLowerCase().replaceAll("-", "_"))
}
