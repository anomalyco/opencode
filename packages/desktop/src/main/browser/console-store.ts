import { REDACTED, redactSensitiveBrowserText, redactSensitiveBrowserUrl } from "../logging"
import type { BrowserConsoleEntry, BrowserConsoleLevel, BrowserConsoleQuery, BrowserConsoleReadResult, BrowserId } from "./types"

const maxEntriesPerBrowser = 200
const defaultQueryLimit = 50
const maxQueryLimit = 100
const maxMessageLength = 1_000

const entriesByBrowser = new Map<BrowserId, BrowserConsoleEntry[]>()

function sanitizeMessage(message: string) {
  const urls: string[] = []
  const protectedMessage = String(message).replace(/https?:\/\/[^\s)"']+/g, (value) => {
    const url = value.endsWith(":") ? value.slice(0, -1) : value
    urls.push(redactSensitiveBrowserUrl(url))
    return `__BROWSER_CONSOLE_URL_${urls.length - 1}__${value.endsWith(":") ? ":" : ""}`
  })

  const sanitized = redactSensitiveBrowserText(protectedMessage)
    .replace(/data:[^\s)"']+/gi, REDACTED)
    .replace(/\b[A-Za-z0-9+/=_-]{80,}\b/g, REDACTED)
    .replace(/__BROWSER_CONSOLE_URL_(\d+)__/g, (_match, index: string) => urls[Number(index)] ?? REDACTED)

  return {
    message: sanitized.slice(0, maxMessageLength),
    ...(sanitized.length > maxMessageLength ? { truncated: true as const } : {}),
  }
}

function sanitizeSource(source: string) {
  if (URL.canParse(source)) return redactSensitiveBrowserUrl(source)
  return sanitizeMessage(source).message
}

export function addBrowserConsoleEntry(entry: Omit<BrowserConsoleEntry, "timestamp"> & { timestamp?: number }) {
  const entries = entriesByBrowser.get(entry.browserId) ?? []
  const message = sanitizeMessage(entry.message)
  entries.push({
    browserId: entry.browserId,
    level: entry.level,
    line: typeof entry.line === "number" ? entry.line : null,
    message: message.message,
    source: sanitizeSource(entry.source),
    timestamp: entry.timestamp ?? Date.now(),
    ...(message.truncated ? { truncated: true as const } : {}),
  })
  entriesByBrowser.set(entry.browserId, entries.slice(-maxEntriesPerBrowser))
}

export function queryBrowserConsoleEntries(query: BrowserConsoleQuery): BrowserConsoleReadResult {
  const levels = query.levels ? new Set<BrowserConsoleLevel>(query.levels) : undefined
  const entries = (entriesByBrowser.get(query.browserId) ?? []).filter((entry) => !levels || levels.has(entry.level))
  const limit = Math.min(maxQueryLimit, Math.max(0, query.limit ?? defaultQueryLimit))

  return {
    browserId: query.browserId,
    entries: entries.slice(-limit),
    ...(entries.length > limit ? { truncated: true as const } : {}),
  }
}

export function clearBrowserConsoleEntries(browserId?: BrowserId) {
  if (browserId === undefined) {
    const count = Array.from(entriesByBrowser.values()).reduce((total, entries) => total + entries.length, 0)
    entriesByBrowser.clear()
    return count
  }

  const count = entriesByBrowser.get(browserId)?.length ?? 0
  entriesByBrowser.delete(browserId)
  return count
}

export function mapElectronConsoleLevel(level: unknown): BrowserConsoleLevel {
  if (typeof level === "string") {
    if (level === "warning") return "warn"
    if (["log", "info", "warn", "error", "debug"].includes(level)) return level as BrowserConsoleLevel
  }

  if (level === 0) return "debug"
  if (level === 2) return "warn"
  if (level === 3) return "error"
  return "info"
}
