import { Schema } from "effect"

const SECRET_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i },
  { label: "API key", pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{20,}\b/ },
  { label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

const ENV_SECRET_NAMES = /(?:API|AUTH|BEARER|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i
const SAFE_ENV_VALUES = new Set(["fixture", "test", "test-key"])

const envSecrets = () =>
  Object.entries(process.env).flatMap(([name, value]) => {
    if (!value || !ENV_SECRET_NAMES.test(name) || value.length < 12 || SAFE_ENV_VALUES.has(value.toLowerCase()))
      return []
    return [{ name, value }]
  })

const pathFor = (base: string, key: string) => (base ? `${base}.${key}` : key)

const stringEntries = (value: unknown, base = ""): ReadonlyArray<{ readonly path: string; readonly value: string }> => {
  if (typeof value === "string") return [{ path: base, value }]
  if (Array.isArray(value)) return value.flatMap((item, index) => stringEntries(item, `${base}[${index}]`))
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, child]) => stringEntries(child, pathFor(base, key)))
  return []
}

export const SecretFindingSchema = Schema.Struct({ path: Schema.String, reason: Schema.String })
export type SecretFinding = Schema.Schema.Type<typeof SecretFindingSchema>

export const secretFindings = (value: unknown): ReadonlyArray<SecretFinding> => {
  const environment = envSecrets()
  return stringEntries(value).flatMap((entry) => [
    ...SECRET_PATTERNS.filter((item) => item.pattern.test(entry.value)).map((item) => ({
      path: entry.path,
      reason: item.label,
    })),
    ...environment
      .filter((item) => entry.value.includes(item.value))
      .map((item) => ({ path: entry.path, reason: `environment secret ${item.name}` })),
  ])
}
