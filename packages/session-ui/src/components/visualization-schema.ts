export const VISUALIZATION_VERSION = 1
export const MAX_TITLE_CODE_POINTS = 120
export const MAX_HTML_BYTES = 128 * 1024
export const MAX_PROMPT_CODE_POINTS = 4_000
export const MAX_ERROR_CODE_POINTS = 500
export const MAX_TOKEN_CODE_POINTS = 256
export const MAX_REQUEST_ID_CODE_POINTS = 128
export const MAX_THEME_VALUE_CODE_POINTS = 256
export const FOLLOW_UP_INIT_TIMEOUT_MS = 10_000
export const FOLLOW_UP_RESPONSE_TIMEOUT_MS = 30_000
export const INITIAL_HEIGHT = 160
export const MIN_HEIGHT = 48
export const COLLAPSED_HEIGHT = 720
export const MAX_HEIGHT = 4_096

export const VISUALIZATION_THEME_VARIABLES = [
  "--v2-background-bg-base",
  "--v2-background-bg-layer-01",
  "--v2-text-text-base",
  "--v2-text-text-muted",
  "--v2-border-border-base",
  "--v2-text-text-accent",
  "--font-family-sans",
  "--font-family-mono",
] as const

export const VISUALIZATION_FOLLOW_UP_STATUSES = ["sent", "cancelled", "rejected"] as const

export type VisualizationResult = {
  version: 1
  title: string
  html: string
}

export type VisualizationMessage =
  | { version: 1; type: "ready"; token: string }
  | { version: 1; type: "resize"; token: string; height: number }
  | { version: 1; type: "followup"; token: string; requestID: string; title?: string; prompt: string }
  | { version: 1; type: "error"; token: string; message: string }

export type VisualizationThemeVariable = (typeof VISUALIZATION_THEME_VARIABLES)[number]
export type VisualizationTheme = Partial<Record<VisualizationThemeVariable, string>>
export type VisualizationFollowUpStatus = (typeof VISUALIZATION_FOLLOW_UP_STATUSES)[number]

export type VisualizationHostMessage =
  | { version: 1; type: "init"; token: string; theme?: VisualizationTheme }
  | { version: 1; type: "theme"; token: string; theme: VisualizationTheme }
  | {
      version: 1
      type: "followup-result"
      token: string
      requestID: string
      status: VisualizationFollowUpStatus
    }

export function decodeVisualizationResult(value: unknown): VisualizationResult | undefined {
  const input = readProperties(value, ["version", "title", "html"] as const)
  if (!input || input.version !== VISUALIZATION_VERSION) return
  const title = boundedTrimmed(input.title, MAX_TITLE_CODE_POINTS)
  if (!title || typeof input.html !== "string" || !input.html.trim()) return
  if (new TextEncoder().encode(input.html).byteLength > MAX_HTML_BYTES) return
  if (documentRoot(input.html)) return
  return { version: VISUALIZATION_VERSION, title, html: input.html }
}

export function decodeVisualizationMessage(value: unknown): VisualizationMessage | undefined {
  const input = readProperties(value, [
    "version",
    "type",
    "token",
    "height",
    "requestID",
    "title",
    "prompt",
    "message",
  ] as const)
  if (!input || input.version !== VISUALIZATION_VERSION) return
  const token = boundedTrimmed(input.token, MAX_TOKEN_CODE_POINTS)
  if (!token) return
  if (input.type === "ready") return { version: VISUALIZATION_VERSION, type: "ready", token }
  if (input.type === "resize") {
    if (typeof input.height !== "number" || !Number.isFinite(input.height) || input.height < 0) return
    return { version: VISUALIZATION_VERSION, type: "resize", token, height: input.height }
  }
  if (input.type === "followup") return decodeFollowUp(input, token)
  if (input.type === "error") {
    const message = cleanError(input.message)
    if (!message) return
    return { version: VISUALIZATION_VERSION, type: "error", token, message }
  }
}

export function decodeVisualizationHostMessage(value: unknown): VisualizationHostMessage | undefined {
  const input = readProperties(value, ["version", "type", "token", "theme", "requestID", "status"] as const)
  if (!input || input.version !== VISUALIZATION_VERSION) return
  const token = boundedTrimmed(input.token, MAX_TOKEN_CODE_POINTS)
  if (!token) return
  if (input.type === "init") {
    if (input.theme === undefined) return { version: VISUALIZATION_VERSION, type: "init", token }
    const theme = decodeTheme(input.theme)
    if (!theme) return
    return { version: VISUALIZATION_VERSION, type: "init", token, theme }
  }
  if (input.type === "theme") {
    const theme = decodeTheme(input.theme)
    if (!theme) return
    return { version: VISUALIZATION_VERSION, type: "theme", token, theme }
  }
  if (input.type !== "followup-result") return
  const requestID = boundedTrimmed(input.requestID, MAX_REQUEST_ID_CODE_POINTS)
  if (!requestID || !followUpStatus(input.status)) return
  return { version: VISUALIZATION_VERSION, type: "followup-result", token, requestID, status: input.status }
}

export function clampVisualizationHeight(value: number) {
  if (!Number.isFinite(value) || value < 0) return
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(value)))
}

function decodeFollowUp(value: Record<string, unknown>, token: string): VisualizationMessage | undefined {
  const requestID = boundedTrimmed(value.requestID, MAX_REQUEST_ID_CODE_POINTS)
  const prompt = boundedTrimmed(value.prompt, MAX_PROMPT_CODE_POINTS)
  if (!requestID || !prompt) return
  if (value.title === undefined) {
    return { version: VISUALIZATION_VERSION, type: "followup", token, requestID, prompt }
  }
  const title = boundedTrimmed(value.title, MAX_TITLE_CODE_POINTS)
  if (!title) return
  return { version: VISUALIZATION_VERSION, type: "followup", token, requestID, title, prompt }
}

function decodeTheme(value: unknown): VisualizationTheme | undefined {
  const input = readProperties(value, VISUALIZATION_THEME_VARIABLES)
  if (!input) return
  const entries = VISUALIZATION_THEME_VARIABLES.flatMap((name) => {
    const item = input[name]
    if (item === undefined) return []
    if (typeof item !== "string" || codePoints(item) > MAX_THEME_VALUE_CODE_POINTS) return [undefined]
    return [[name, item] as const]
  })
  if (entries.some((entry) => entry === undefined)) return
  return Object.fromEntries(entries.filter((entry) => entry !== undefined))
}

function cleanError(value: unknown) {
  if (typeof value !== "string") return
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return
  return Array.from(cleaned).slice(0, MAX_ERROR_CODE_POINTS).join("")
}

function boundedTrimmed(value: unknown, maximum: number) {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  if (!trimmed || codePoints(trimmed) > maximum) return
  return trimmed
}

function documentRoot(html: string) {
  const roots = new Set(["html", "head", "body"])
  const rawText = new Set(["script", "style"])
  let index = 0
  let raw: string | undefined
  while (index < html.length) {
    const start = html.indexOf("<", index)
    if (start < 0) return false
    const token = readTag(html, start)
    if (raw) {
      if (token?.closing && token.name === raw) raw = undefined
      index = token?.end ?? start + 1
      continue
    }
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4)
      if (end < 0) return false
      index = end + 3
      continue
    }
    if (!token) {
      index = start + 1
      continue
    }
    if (token.doctype || (token.name && roots.has(token.name))) return true
    if (!token.closing && token.name && rawText.has(token.name)) raw = token.name
    index = token.end
  }
  return false
}

function followUpStatus(value: unknown): value is VisualizationFollowUpStatus {
  return VISUALIZATION_FOLLOW_UP_STATUSES.some((status) => status === value)
}

function readTag(html: string, start: number) {
  let quote: '"' | "'" | undefined
  let cursor = start + 1
  while (cursor < html.length) {
    const character = html[cursor]
    if (quote) {
      if (character === quote) quote = undefined
      cursor++
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      cursor++
      continue
    }
    if (character === ">") break
    cursor++
  }
  const source = html.slice(start + 1, cursor).trimStart()
  if (/^!\s*doctype(?:\s|$)/i.test(source)) return { end: Math.min(cursor + 1, html.length), doctype: true }
  const match = source.match(/^(\/)?\s*([a-z][a-z0-9:-]*)(?=[\s/>]|$)/i)
  if (!match) return
  return {
    end: Math.min(cursor + 1, html.length),
    closing: !!match[1],
    name: match[2].toLowerCase(),
    doctype: false,
  }
}

function codePoints(value: string) {
  return Array.from(value).length
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function readProperties<const Keys extends readonly string[]>(value: unknown, keys: Keys) {
  const input = readRecord(value)
  if (!input) return
  const entries = keys.map((key) => readProperty(input, key))
  if (entries.some((entry) => entry === undefined)) return
  return Object.fromEntries(entries.filter((entry) => entry !== undefined)) as Record<Keys[number], unknown>
}

function readRecord(value: unknown) {
  try {
    if (record(value)) return value
  } catch {
    return
  }
}

function readProperty(value: Record<string, unknown>, key: string) {
  try {
    return [key, value[key]] as const
  } catch {
    return
  }
}
