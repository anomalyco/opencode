import fs from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util"
import type { ProviderID } from "./schema"

const log = Log.create({ service: "provider.rate-limit" })

type HeaderSnapshot = {
  limit?: number
  remaining?: number
  resetAt?: number
}

type State = {
  minute: number[]
  day: number[]
  learned: { perMinute?: number; perDay?: number }
  headers?: { requests?: HeaderSnapshot; tokens?: HeaderSnapshot }
  loggedHeaders: boolean
}

const state = new Map<ProviderID, State>()

function ensure(providerID: ProviderID): State {
  const existing = state.get(providerID)
  if (existing) return existing
  const next: State = { minute: [], day: [], learned: {}, loggedHeaders: false }
  state.set(providerID, next)
  return next
}

function prune(s: State) {
  const now = Date.now()
  const minuteCutoff = now - 60_000
  const dayCutoff = now - 86_400_000
  s.minute = s.minute.filter((t) => t > minuteCutoff)
  s.day = s.day.filter((t) => t > dayCutoff)
}

export function tick(providerID: ProviderID) {
  const s = ensure(providerID)
  const now = Date.now()
  s.minute.push(now)
  s.day.push(now)
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

function parseReset(value: string | null): number | undefined {
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
  if (requests || tokens) {
    s.headers = { requests, tokens }
  }
  if (!s.loggedHeaders) {
    s.loggedHeaders = true
    log.info("provider first response headers", {
      providerID,
      rateLimitHeaders: requests || tokens ? { requests, tokens } : "none",
      keys: Array.from(headers.keys()).filter((k) => k.includes("ratelimit") || k === "retry-after"),
    })
  }
}

export function onRateLimitError(providerID: ProviderID) {
  const s = ensure(providerID)
  prune(s)
  const perMinute = s.minute.length
  const perDay = s.day.length
  if (perMinute === 0 && perDay === 0) return
  s.learned.perMinute = Math.max(s.learned.perMinute ?? 0, perMinute)
  s.learned.perDay = Math.max(s.learned.perDay ?? 0, perDay)
  try {
    persistLearnedLimits(providerID, s.learned.perMinute, s.learned.perDay)
    log.info("learned rate limit from 429", { providerID, perMinute, perDay })
  } catch (e) {
    log.warn("failed to persist learned rate limit", { providerID, error: String(e) })
  }
}

function persistLearnedLimits(providerID: ProviderID, perMinute: number, perDay: number) {
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
  rateLimit.perMinute = Math.max(rateLimit.perMinute ?? 0, perMinute)
  rateLimit.perDay = Math.max(rateLimit.perDay ?? 0, perDay)
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + "\n")
}

function readJsonSafe(p: string): Record<string, any> {
  if (!fs.existsSync(p)) return {}
  const raw = fs.readFileSync(p, "utf8")
  if (raw.trim() === "") return {}
  return JSON.parse(raw)
}

export type Snapshot = {
  minute: { count: number; limit?: number }
  day: { count: number; limit?: number }
  headers?: { requests?: HeaderSnapshot; tokens?: HeaderSnapshot }
}

export function snapshot(providerID: ProviderID): Snapshot {
  const s = ensure(providerID)
  prune(s)
  return {
    minute: { count: s.minute.length, limit: s.learned.perMinute },
    day: { count: s.day.length, limit: s.learned.perDay },
    headers: s.headers,
  }
}

export function reset(providerID?: ProviderID) {
  if (providerID) {
    state.delete(providerID)
    return
  }
  state.clear()
}

export * as RateLimit from "./rate-limit"
