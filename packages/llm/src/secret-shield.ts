import { LLMRequest, Message, ToolDefinition, type ContentPart, type SystemPart } from "./schema/messages"

export const REDACTED = "[REDACTED]"

export type SecretShieldMode = "off" | "warn" | "mask" | "block"

export interface RedactResult {
  readonly text: string
  readonly count: number
}

export interface ShieldReport {
  readonly mode: SecretShieldMode
  readonly detected: number
  readonly error?: string
}

export type ShieldResult =
  | { readonly _tag: "ok"; readonly request: LLMRequest; readonly report: ShieldReport }
  | { readonly _tag: "blocked"; readonly report: ShieldReport }

// ── Mode resolution ─────────────────────────────────────────────────────────

const MASK_ALIASES = new Set(["1", "true", "yes", "on", "mask"])
const VALID_MODES: ReadonlySet<string> = new Set(["off", "warn", "mask", "block"])

export const resolveMode = (override?: string): SecretShieldMode => {
  if (override && VALID_MODES.has(override)) return override as SecretShieldMode
  const raw = process.env.OPENCODE_SECRET_SHIELD
  if (raw === undefined) return "off"
  const val = raw.trim().toLowerCase()
  if (VALID_MODES.has(val)) return val as SecretShieldMode
  if (MASK_ALIASES.has(val)) return "mask"
  return "off"
}

// ── Patterns ────────────────────────────────────────────────────────────────

const PREFIX_PATTERNS: ReadonlyArray<RegExp> = [
  /AIza[A-Za-z0-9_-]{20,}/g,
  /GOCSPX-[A-Za-z0-9_-]{10,}/g,
  /ya29\.[A-Za-z0-9._~-]{10,}/g,
  /sk-[A-Za-z0-9_-]{12,}/g,
  /gsk_[A-Za-z0-9_-]{12,}/g,
  /(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})/g,
  /(?:glpat|glrt|gldt|glsoat|glcbt)-[A-Za-z0-9_-]{10,}/g,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  /perm-[A-Za-z0-9_-]{12,}/g,
  /[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /(?:xox[a-z]|xapp)-[A-Za-z0-9_-]{8,}/g,
  /SG\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g,
  /hf_[A-Za-z0-9]{12,}/g,
  /npm_[A-Za-z0-9]{12,}/g,
  /pypi-[A-Za-z0-9_-]{12,}/g,
  /hv[sbr]\.[A-Za-z0-9_-]{12,}/g,
]

const JSON_SENSITIVE =
  /"(?:password|passwd|pwd|secret|token|api_key|apikey|client_secret|access_token|refresh_token|private_key|authorization)"\s*:\s*(?<value>"(?:[^"\\]|\\.)*")/gi

const HEADER =
  /^[ \t]*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)[ \t]*:[ \t]*(?<value>[^\r\n]+)/gim

const AUTH_SCHEME = /\b(?:Bearer|Basic|OAuth)\s+(?<value>[A-Za-z0-9._+/=-]{8,})/gi

const URI =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?|amqp(?:s)?):[/][/](?<userinfo>[^/\s?#<>"']+)@/gi

const JWT = /(?<![A-Za-z0-9_-])(?<token>[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)(?![A-Za-z0-9_.-])/g

// ── Helpers ─────────────────────────────────────────────────────────────────

const replaceGroup = (source: string, pattern: RegExp, group: string): RedactResult => {
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

export const redact = (text: string): RedactResult => {
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

// ── Message-level scanning ──────────────────────────────────────────────────

const redactContentParts = (
  parts: ReadonlyArray<ContentPart>,
): { parts: ReadonlyArray<ContentPart>; count: number } => {
  let total = 0
  let changed = false
  const next = parts.map((part) => {
    if (part.type !== "text") return part
    const r = redact(part.text)
    if (r.count === 0) return part
    total += r.count
    changed = true
    return { ...part, text: r.text }
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
  tools: ReadonlyArray<ToolDefinition>,
): { tools: ReadonlyArray<ToolDefinition>; count: number } => {
  let total = 0
  let changed = false
  const next = tools.map((tool) => {
    const r = redact(tool.description)
    if (r.count === 0) return tool
    total += r.count
    changed = true
    return new ToolDefinition({ ...tool, description: r.text })
  })
  return { tools: changed ? next : tools, count: total }
}

// ── Request-level entry point ───────────────────────────────────────────────

const makeReport = (mode: SecretShieldMode, detected: number, error?: string): ShieldReport => ({
  mode,
  detected,
  error,
})

export const applySecretShield = (request: LLMRequest, mode?: string): ShieldResult => {
  const resolved = resolveMode(mode)
  if (resolved === "off") return { _tag: "ok", request, report: makeReport(resolved, 0) }

  try {
    const msgs = redactMessages(request.messages)
    const sys = redactSystem(request.system)
    const tls = redactTools(request.tools)
    const total = msgs.count + sys.count + tls.count

    if (resolved === "warn") return { _tag: "ok", request, report: makeReport(resolved, total) }
    if (resolved === "block" && total > 0) return { _tag: "blocked", report: makeReport(resolved, total) }
    if (total === 0) return { _tag: "ok", request, report: makeReport(resolved, 0) }

    return {
      _tag: "ok",
      request: LLMRequest.update(request, {
        messages: msgs.messages,
        system: sys.system,
        tools: tls.tools,
      }),
      report: makeReport(resolved, total),
    }
  } catch {
    return {
      _tag: "blocked",
      report: makeReport(resolved, 0, "Secret Shield internal error; blocking to prevent credential leak"),
    }
  }
}
