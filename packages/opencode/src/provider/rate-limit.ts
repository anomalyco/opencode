import fs from "fs"
import path from "path"
import z from "zod"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Global } from "../global"
import { Log } from "../util"
import { estimate as estimateTokens } from "../util/token"
import type { ProviderID } from "./schema"

const log = Log.create({ service: "provider.rate-limit" })

type HeaderSnapshot = {
  limit?: number
  remaining?: number
  resetAt?: number
}

type TokenEntry = {
  t: number
  count: number
  pending: boolean
}

type State = {
  minute: number[]
  day: number[]
  tokensMinute: TokenEntry[]
  tokensDay: TokenEntry[]
  learned: { perMinute?: number; perDay?: number; tokensPerMinute?: number; tokensPerDay?: number }
  headers?: { requests?: HeaderSnapshot; tokens?: HeaderSnapshot }
  loggedHeaders: boolean
}

const state = new Map<ProviderID, State>()

function ensure(providerID: ProviderID): State {
  const existing = state.get(providerID)
  if (existing) return existing
  const next: State = {
    minute: [],
    day: [],
    tokensMinute: [],
    tokensDay: [],
    learned: {},
    loggedHeaders: false,
  }
  state.set(providerID, next)
  return next
}

function prune(s: State) {
  const now = Date.now()
  s.minute = s.minute.filter((t) => t > now - 60_000)
  s.day = s.day.filter((t) => t > now - 86_400_000)
  s.tokensMinute = s.tokensMinute.filter((e) => e.t > now - 60_000)
  s.tokensDay = s.tokensDay.filter((e) => e.t > now - 86_400_000)
}

function sumTokens(entries: TokenEntry[]): number {
  let total = 0
  for (const e of entries) total += e.count
  return total
}

export function estimateRequestTokens(body: unknown): number {
  if (body == null) return 0
  try {
    if (typeof body === "string") return estimateTokens(body)
    if (body instanceof Uint8Array) return estimateTokens(new TextDecoder().decode(body))
    return estimateTokens(JSON.stringify(body))
  } catch {
    return 0
  }
}

export function tick(providerID: ProviderID, estimatedTokens = 0) {
  const s = ensure(providerID)
  const now = Date.now()
  s.minute.push(now)
  s.day.push(now)
  if (estimatedTokens > 0) {
    const entry: TokenEntry = { t: now, count: estimatedTokens, pending: true }
    s.tokensMinute.push(entry)
    s.tokensDay.push({ ...entry })
  }
  prune(s)
}

export function recordUsage(providerID: ProviderID, inputTokens: number, outputTokens: number) {
  const s = ensure(providerID)
  const actual = Math.max(0, Math.round((inputTokens ?? 0) + (outputTokens ?? 0)))
  if (actual === 0) return
  const replaceOldestPending = (entries: TokenEntry[]) => {
    for (const e of entries) {
      if (e.pending) {
        e.count = actual
        e.pending = false
        return true
      }
    }
    return false
  }
  const now = Date.now()
  if (!replaceOldestPending(s.tokensMinute)) {
    s.tokensMinute.push({ t: now, count: actual, pending: false })
  }
  if (!replaceOldestPending(s.tokensDay)) {
    s.tokensDay.push({ t: now, count: actual, pending: false })
  }
  prune(s)
}

const REQUEST_HEADER_FAMILIES: Array<[string, string, string]> = [
  ["x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-reset-requests"],
  ["anthropic-ratelimit-requests-limit", "anthropic-ratelimit-requests-remaining", "anthropic-ratelimit-requests-reset"],
  ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"],
]

const TOKEN_HEADER_FAMILIES: Array<[string, string, string]> = [
  ["x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens"],
  ["anthropic-ratelimit-tokens-limit", "anthropic-ratelimit-tokens-remaining", "anthropic-ratelimit-tokens-reset"],
]

function parseFamily(headers: Headers, family: Array<[string, string, string]>): HeaderSnapshot | undefined {
  for (const [limitKey, remainingKey, resetKey] of family) {
    const limit = headers.get(limitKey)
    const remaining = headers.get(remainingKey)
    if (!limit && !remaining) continue
    const reset = headers.get(resetKey)
    const resetAt = parseReset(reset)
    return {
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      remaining: remaining ? Number.parseInt(remaining, 10) : undefined,
      resetAt,
    }
  }
  return undefined
}

export function parseReset(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const asNumber = Number.parseFloat(value)
  if (!Number.isNaN(asNumber)) {
    if (asNumber > 1_000_000_000_000) return Math.round(asNumber)
    if (asNumber > 1_000_000_000) return Math.round(asNumber * 1000)
    return Date.now() + Math.round(asNumber * 1000)
  }
  const asDate = Date.parse(value)
  if (!Number.isNaN(asDate)) return asDate
  return undefined
}

export function recordResponse(providerID: ProviderID, headers: Headers) {
  const s = ensure(providerID)
  const requests = parseFamily(headers, REQUEST_HEADER_FAMILIES)
  const tokens = parseFamily(headers, TOKEN_HEADER_FAMILIES)
  const parsed = requests || tokens ? { requests, tokens } : undefined
  if (parsed) s.headers = parsed
  if (!s.loggedHeaders) {
    s.loggedHeaders = true
    log.info("provider first response headers", {
      providerID,
      rateLimitHeaders: parsed ?? "none",
      keys: Array.from(headers.keys()).filter((k) => k.includes("ratelimit") || k === "retry-after"),
    })
  }
}

export function onRateLimitError(providerID: ProviderID) {
  const s = ensure(providerID)
  prune(s)
  const perMinute = s.minute.length
  const perDay = s.day.length
  const tokensPerMinute = Math.round(sumTokens(s.tokensMinute))
  const tokensPerDay = Math.round(sumTokens(s.tokensDay))
  if (perMinute === 0 && perDay === 0 && tokensPerMinute === 0 && tokensPerDay === 0) return
  if (perMinute > 0) s.learned.perMinute = Math.max(s.learned.perMinute ?? 0, perMinute)
  if (perDay > 0) s.learned.perDay = Math.max(s.learned.perDay ?? 0, perDay)
  if (tokensPerMinute > 0) s.learned.tokensPerMinute = Math.max(s.learned.tokensPerMinute ?? 0, tokensPerMinute)
  if (tokensPerDay > 0) s.learned.tokensPerDay = Math.max(s.learned.tokensPerDay ?? 0, tokensPerDay)
  try {
    persistLearnedLimits(providerID, s.learned)
    log.info("learned rate limit from 429", {
      providerID,
      perMinute,
      perDay,
      tokensPerMinute,
      tokensPerDay,
    })
  } catch (e) {
    log.warn("failed to persist learned rate limit", { providerID, error: String(e) })
  }
}

function persistLearnedLimits(providerID: ProviderID, learned: State["learned"]) {
  const jsoncPath = path.join(Global.Path.config, "opencode.jsonc")
  if (fs.existsSync(jsoncPath)) {
    log.warn("opencode.jsonc detected; skipping learned-limit write to preserve comments", {
      providerID,
      path: jsoncPath,
    })
    return
  }
  const jsonPath = path.join(Global.Path.config, "opencode.json")
  const data = readJsonSafe(jsonPath)
  data.provider ??= {}
  data.provider[providerID] ??= {}
  data.provider[providerID].options ??= {}
  const rateLimit = (data.provider[providerID].options.rateLimit ??= {})
  if (learned.perMinute !== undefined)
    rateLimit.perMinute = Math.max(rateLimit.perMinute ?? 0, learned.perMinute)
  if (learned.perDay !== undefined) rateLimit.perDay = Math.max(rateLimit.perDay ?? 0, learned.perDay)
  if (learned.tokensPerMinute !== undefined)
    rateLimit.tokensPerMinute = Math.max(rateLimit.tokensPerMinute ?? 0, learned.tokensPerMinute)
  if (learned.tokensPerDay !== undefined)
    rateLimit.tokensPerDay = Math.max(rateLimit.tokensPerDay ?? 0, learned.tokensPerDay)
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n")
}

function readJsonSafe(p: string): Record<string, any> {
  let raw = ""
  try {
    raw = fs.readFileSync(p, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
  }
  return raw.trim() === "" ? {} : JSON.parse(raw)
}

export function configure(
  providerID: ProviderID,
  limits: { perMinute?: number; perDay?: number; tokensPerMinute?: number; tokensPerDay?: number } | undefined,
) {
  if (!limits) return
  const s = ensure(providerID)
  if (limits.perMinute !== undefined && limits.perMinute > 0)
    s.learned.perMinute = Math.max(s.learned.perMinute ?? 0, limits.perMinute)
  if (limits.perDay !== undefined && limits.perDay > 0)
    s.learned.perDay = Math.max(s.learned.perDay ?? 0, limits.perDay)
  if (limits.tokensPerMinute !== undefined && limits.tokensPerMinute > 0)
    s.learned.tokensPerMinute = Math.max(s.learned.tokensPerMinute ?? 0, limits.tokensPerMinute)
  if (limits.tokensPerDay !== undefined && limits.tokensPerDay > 0)
    s.learned.tokensPerDay = Math.max(s.learned.tokensPerDay ?? 0, limits.tokensPerDay)
}

export type GateReason = "requests-minute" | "requests-day" | "tokens-minute" | "tokens-day"

export type Gate =
  | { ok: true }
  | {
      ok: false
      reason: GateReason
      limit: number
      current: number
      resetAt: number
    }

export const RateLimitError = NamedError.create(
  "RateLimitError",
  z.object({
    providerID: z.string(),
    reason: z.enum(["requests-minute", "requests-day", "tokens-minute", "tokens-day"]),
    limit: z.number(),
    current: z.number(),
    resetAt: z.number(),
    message: z.string(),
  }),
)
export type RateLimitError = z.infer<typeof RateLimitError.Schema>

export function formatGateMessage(providerID: ProviderID, gate: Extract<Gate, { ok: false }>): string {
  const seconds = Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000))
  const labels: Record<GateReason, string> = {
    "requests-minute": "requests/minute",
    "requests-day": "requests/day",
    "tokens-minute": "tokens/minute",
    "tokens-day": "tokens/day",
  }
  return `Rate limit on ${providerID}: ${gate.current}/${gate.limit} ${labels[gate.reason]}. Retry in ${seconds}s.`
}

function minuteResetAt(timestamps: number[]): number {
  if (timestamps.length === 0) return Date.now() + 60_000
  return timestamps[0]! + 60_000
}

function dayResetAt(timestamps: number[]): number {
  if (timestamps.length === 0) return Date.now() + 86_400_000
  return timestamps[0]! + 86_400_000
}

function minuteResetAtTokens(entries: TokenEntry[]): number {
  if (entries.length === 0) return Date.now() + 60_000
  return entries[0]!.t + 60_000
}

function dayResetAtTokens(entries: TokenEntry[]): number {
  if (entries.length === 0) return Date.now() + 86_400_000
  return entries[0]!.t + 86_400_000
}

export function check(providerID: ProviderID, estimatedTokens = 0): Gate {
  const s = ensure(providerID)
  prune(s)

  const effective = {
    perMinute: s.learned.perMinute,
    perDay: s.learned.perDay,
    tokensPerMinute: s.learned.tokensPerMinute,
    tokensPerDay: s.learned.tokensPerDay,
  }

  // Server-advertised remaining takes precedence if it would trip sooner
  const hdrReq = s.headers?.requests
  if (hdrReq?.remaining !== undefined && hdrReq.remaining <= 0) {
    return {
      ok: false,
      reason: "requests-minute",
      limit: hdrReq.limit ?? s.minute.length,
      current: s.minute.length,
      resetAt: hdrReq.resetAt ?? minuteResetAt(s.minute),
    }
  }
  const hdrTok = s.headers?.tokens
  if (hdrTok?.remaining !== undefined && hdrTok.remaining < estimatedTokens) {
    return {
      ok: false,
      reason: "tokens-minute",
      limit: hdrTok.limit ?? Math.round(sumTokens(s.tokensMinute)),
      current: Math.round(sumTokens(s.tokensMinute)),
      resetAt: hdrTok.resetAt ?? minuteResetAtTokens(s.tokensMinute),
    }
  }

  if (effective.perMinute && s.minute.length + 1 > effective.perMinute) {
    return {
      ok: false,
      reason: "requests-minute",
      limit: effective.perMinute,
      current: s.minute.length,
      resetAt: minuteResetAt(s.minute),
    }
  }
  if (effective.perDay && s.day.length + 1 > effective.perDay) {
    return {
      ok: false,
      reason: "requests-day",
      limit: effective.perDay,
      current: s.day.length,
      resetAt: dayResetAt(s.day),
    }
  }
  if (effective.tokensPerMinute && sumTokens(s.tokensMinute) + estimatedTokens > effective.tokensPerMinute) {
    return {
      ok: false,
      reason: "tokens-minute",
      limit: effective.tokensPerMinute,
      current: Math.round(sumTokens(s.tokensMinute)),
      resetAt: minuteResetAtTokens(s.tokensMinute),
    }
  }
  if (effective.tokensPerDay && sumTokens(s.tokensDay) + estimatedTokens > effective.tokensPerDay) {
    return {
      ok: false,
      reason: "tokens-day",
      limit: effective.tokensPerDay,
      current: Math.round(sumTokens(s.tokensDay)),
      resetAt: dayResetAtTokens(s.tokensDay),
    }
  }

  return { ok: true }
}

export type Snapshot = {
  minute: { count: number; limit?: number }
  day: { count: number; limit?: number }
  tokensMinute: { count: number; limit?: number }
  tokensDay: { count: number; limit?: number }
  headers?: { requests?: HeaderSnapshot; tokens?: HeaderSnapshot }
}

export function snapshot(providerID: ProviderID): Snapshot {
  const s = ensure(providerID)
  prune(s)
  return {
    minute: { count: s.minute.length, limit: s.learned.perMinute },
    day: { count: s.day.length, limit: s.learned.perDay },
    tokensMinute: { count: Math.round(sumTokens(s.tokensMinute)), limit: s.learned.tokensPerMinute },
    tokensDay: { count: Math.round(sumTokens(s.tokensDay)), limit: s.learned.tokensPerDay },
    headers: s.headers,
  }
}

export function snapshotAll(): Record<ProviderID, Snapshot> {
  const result: Record<string, Snapshot> = {}
  for (const id of state.keys()) result[id] = snapshot(id)
  return result
}

export function reset(providerID?: ProviderID) {
  if (providerID) {
    state.delete(providerID)
    return
  }
  state.clear()
}

export * as RateLimit from "./rate-limit"
