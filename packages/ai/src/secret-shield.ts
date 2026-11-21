import {
  LLMRequest,
  Message,
  ToolDefinition,
  type ContentPart,
  type SystemPart,
  type ToolEntry,
  type ToolResultPart,
} from "./schema/messages.js"

export const REDACTED = "[REDACTED]"

export type SecretShieldMode = "off" | "warn" | "mask" | "block"

const VALID_MODES: ReadonlySet<string> = new Set(["off", "warn", "mask", "block"])

export const isSecretShieldMode = (value: string): value is SecretShieldMode => VALID_MODES.has(value)

export interface ShieldReport {
  readonly mode: SecretShieldMode
  readonly detected: number
  readonly error?: string
}

export type ShieldResult =
  | { readonly _tag: "ok"; readonly request: LLMRequest; readonly report: ShieldReport }
  | { readonly _tag: "blocked"; readonly report: ShieldReport }

// ── Patterns ────────────────────────────────────────────────────────────────

const PREFIX_PATTERNS: ReadonlyArray<RegExp> = [
  /AIza[A-Za-z0-9_-]{20,}/g,
  /GOCSPX-[A-Za-z0-9_-]{10,}/g,
  /ya29\.[A-Za-z0-9._~-]{10,}/g,
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{12,}/g,
  /(?<![A-Za-z0-9])gsk_[A-Za-z0-9_-]{12,}/g,
  /(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})/g,
  /(?:glpat|glrt|gldt|glsoat|glcbt)-[A-Za-z0-9_-]{10,}/g,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  /(?<![A-Za-z0-9])perm-[A-Za-z0-9_-]{12,}/g,
  /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /(?:xox[a-z]|xapp)-[A-Za-z0-9_-]{8,}/g,
  /SG\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g,
  /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{12,}/g,
  /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{12,}/g,
  /(?<![A-Za-z0-9])pypi-[A-Za-z0-9_-]{12,}/g,
  /(?<![A-Za-z0-9])hv[sbr]\.[A-Za-z0-9_-]{12,}/g,
]

const JSON_SENSITIVE =
  /"(?:password|passwd|pwd|secret|token|api_key|apikey|client_secret|access_token|refresh_token|private_key|authorization)"\s*:\s*(?<value>"(?:[^"\\]|\\.)+")/gi

const HEADER =
  /^[ \t]*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)[ \t]*:[ \t]*(?<value>(?=[^\r\n]*[0-9])[^\r\n]+)/gim

const AUTH_SCHEME = /\b(?:Bearer|Basic|OAuth)\s+(?<value>(?=[A-Za-z0-9._+/=-]*[0-9])[A-Za-z0-9._+/=-]{8,})/gi

const URI =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?|amqp(?:s)?):[/][/](?<userinfo>[^/\s?#<>"']+)@/gi

const JWT = /(?<![A-Za-z0-9_-])(?<token>[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)(?![A-Za-z0-9_.-])/g

// ── Helpers ─────────────────────────────────────────────────────────────────

const replaceGroup = (source: string, pattern: RegExp, group: string): { text: string; count: number } => {
  let count = 0
  const text = source.replace(pattern, (...args) => {
    const groups = args.at(-1) as Record<string, string>
    const value = groups[group]
    if (!value || value === REDACTED) return args[0] as string
    count++
    const full = args[0] as string
    const idx = full.indexOf(value)
    return full.slice(0, idx) + REDACTED + full.slice(idx + value.length)
  })
  return { text, count }
}

const isJwtHeader = (segment: string): boolean => {
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4)
  const swapped = padded.replace(/-/g, "+").replace(/_/g, "/")
  try {
    const decoded = atob(swapped)
    const header = JSON.parse(decoded) as Record<string, unknown>
    return typeof header === "object" && header !== null && ("alg" in header || "enc" in header)
  } catch {
    return false
  }
}

// ── Core redaction ──────────────────────────────────────────────────────────

export const redact = (text: string): { text: string; count: number } => {
  let result = text
  let total = 0

  for (const pattern of PREFIX_PATTERNS) {
    pattern.lastIndex = 0
    let count = 0
    result = result.replace(pattern, () => {
      count++
      return REDACTED
    })
    total += count
  }

  const json = replaceGroup(result, JSON_SENSITIVE, "value")
  result = json.text
  total += json.count

  for (const pattern of [HEADER, AUTH_SCHEME]) {
    const r = replaceGroup(result, pattern, "value")
    result = r.text
    total += r.count
  }

  const uri = replaceGroup(result, URI, "userinfo")
  result = uri.text
  total += uri.count

  JWT.lastIndex = 0
  result = result.replace(JWT, (...args) => {
    const groups = args.at(-1) as Record<string, string>
    const token = groups.token!
    const parts = token.split(".")
    if (parts.length !== 3) return token
    if (!isJwtHeader(parts[0]!)) return token
    total++
    return REDACTED
  })

  return { text: result, count: total }
}

export const scan = (text: string): number => redact(text).count

// ── Recursive string-leaf walker ─────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
  "client_secret", "access_token", "refresh_token", "private_key", "authorization",
])

const isSensitiveKey = (key: string) => SENSITIVE_KEYS.has(key.toLowerCase())

const redactUnknown = (value: unknown, sensitiveContext = false): { value: unknown; count: number } => {
  if (typeof value === "string") {
    if (sensitiveContext && value.length > 0) return { value: REDACTED, count: 1 }
    const r = redact(value)
    return r.count > 0 ? { value: r.text, count: r.count } : { value, count: 0 }
  }
  if (Array.isArray(value)) {
    let total = 0
    let changed = false
    const next = value.map((item) => {
      const r = redactUnknown(item, sensitiveContext)
      if (r.count === 0) return item
      total += r.count
      changed = true
      return r.value
    })
    return { value: changed ? next : value, count: total }
  }
  if (value !== null && typeof value === "object") {
    let total = 0
    let changed = false
    const entries = Object.entries(value as Record<string, unknown>)
    const next: Record<string, unknown> = {}
    for (const [k, v] of entries) {
      const r = redactUnknown(v, isSensitiveKey(k))
      next[k] = r.count > 0 ? r.value : v
      if (r.count > 0) changed = true
      total += r.count
    }
    return { value: changed ? next : value, count: total }
  }
  return { value, count: 0 }
}

// ── Tool result scanning ────────────────────────────────────────────────────

const redactToolResultValue = (
  result: ToolResultPart["result"],
): { result: ToolResultPart["result"]; count: number } => {
  if (result.type === "content") {
    let total = 0
    let changed = false
    const items = result.value.map((item) => {
      if (item.type !== "text") return item
      const r = redact(item.text)
      if (r.count === 0) return item
      total += r.count
      changed = true
      return { ...item, text: r.text } as typeof item
    })
    return { result: changed ? ({ ...result, value: items } as typeof result) : result, count: total }
  }
  const r = redactUnknown(result.value)
  if (r.count === 0) return { result, count: 0 }
  return { result: { ...result, value: r.value }, count: r.count }
}

// ── Message-level scanning ──────────────────────────────────────────────────

const redactContentParts = (
  parts: ReadonlyArray<ContentPart>,
): { parts: ReadonlyArray<ContentPart>; count: number } => {
  let total = 0
  let changed = false
  const next = parts.map((part): ContentPart => {
    if (part.type === "text" || part.type === "reasoning") {
      const r = redact(part.text)
      if (r.count === 0) return part
      total += r.count
      changed = true
      return { ...part, text: r.text }
    }
    if (part.type === "tool-result") {
      const r = redactToolResultValue(part.result)
      if (r.count === 0) return part
      total += r.count
      changed = true
      return { ...part, result: r.result } as ContentPart
    }
    if (part.type === "tool-call" && part.input !== undefined) {
      const r = redactUnknown(part.input)
      if (r.count === 0) return part
      total += r.count
      changed = true
      return { ...part, input: r.value }
    }
    return part
  })
  return { parts: changed ? next : parts, count: total }
}

export const redactMessages = (
  messages: ReadonlyArray<Message>,
): { messages: ReadonlyArray<Message>; count: number } => {
  let total = 0
  let changed = false
  const next = messages.map((msg) => {
    const r = redactContentParts(msg.content)
    if (r.count === 0) return msg
    total += r.count
    changed = true
    return new Message({ ...msg, content: r.parts })
  })
  return { messages: changed ? next : messages, count: total }
}

export const redactSystem = (
  system: ReadonlyArray<SystemPart>,
): { system: ReadonlyArray<SystemPart>; count: number } => {
  let total = 0
  let changed = false
  const next = system.map((part) => {
    const r = redact(part.text)
    if (r.count === 0) return part
    total += r.count
    changed = true
    return { ...part, text: r.text }
  })
  return { system: changed ? next : system, count: total }
}

export const redactTools = (
  tools: ReadonlyArray<ToolEntry>,
): { tools: ReadonlyArray<ToolEntry>; count: number } => {
  let total = 0
  let changed = false
  const next = tools.map((entry): ToolEntry => {
    if (entry.type === "namespace") {
      const nested = redactTools(entry.tools)
      const desc = entry.description ? redact(entry.description) : undefined
      const count = nested.count + (desc?.count ?? 0)
      if (count === 0) return entry
      total += count
      changed = true
      return { ...entry, ...(desc && desc.count > 0 ? { description: desc.text } : {}), tools: nested.tools }
    }
    const r = redact(entry.description)
    if (r.count === 0) return entry
    total += r.count
    changed = true
    return new ToolDefinition({ ...entry, description: r.text })
  })
  return { tools: changed ? next : tools, count: total }
}

// ── Request-level entry point ───────────────────────────────────────────────

const makeReport = (mode: SecretShieldMode, detected: number, error?: string): ShieldReport => ({
  mode,
  detected,
  error,
})

export const applySecretShield = (request: LLMRequest, mode: SecretShieldMode): ShieldResult => {
  if (mode === "off") return { _tag: "ok", request, report: makeReport(mode, 0) }

  try {
    const msgs = redactMessages(request.messages)
    const sys = redactSystem(request.system)
    const tls = redactTools(request.tools)
    const total = msgs.count + sys.count + tls.count

    if (mode === "warn") return { _tag: "ok", request, report: makeReport(mode, total) }
    if (mode === "block" && total > 0) return { _tag: "blocked", report: makeReport(mode, total) }
    if (total === 0) return { _tag: "ok", request, report: makeReport(mode, 0) }

    return {
      _tag: "ok",
      request: LLMRequest.update(request, { messages: msgs.messages, system: sys.system, tools: tls.tools }),
      report: makeReport(mode, total),
    }
  } catch {
    return {
      _tag: "blocked",
      report: makeReport(mode, 0, "Secret Shield internal error; blocking to prevent credential leak"),
    }
  }
}
