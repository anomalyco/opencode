import z from "zod"
import { Auth } from "../auth/index.js"
import { Bus } from "../bus/index.js"
import { BusEvent } from "../bus/bus-event.js"
import { Storage } from "../storage/storage.js"
import { Log } from "../util/log.js"

const log = Log.create({ service: "usage" })

export const planTypeSchema = z.enum([
  "guest",
  "free",
  "go",
  "plus",
  "pro",
  "free_workspace",
  "team",
  "business",
  "education",
  "quorum",
  "k12",
  "enterprise",
  "edu",
])
export type PlanType = z.infer<typeof planTypeSchema>

export const rateLimitWindowSchema = z.object({
  usedPercent: z.number(),
  windowMinutes: z.number().nullable(),
  resetsAt: z.number().nullable(),
})
export type RateLimitWindow = z.infer<typeof rateLimitWindowSchema>

export const creditsSnapshotSchema = z.object({
  hasCredits: z.boolean(),
  unlimited: z.boolean(),
  balance: z.string().nullable(),
})
export type CreditsSnapshot = z.infer<typeof creditsSnapshotSchema>

export const snapshotSchema = z.object({
  primary: rateLimitWindowSchema.nullable(),
  secondary: rateLimitWindowSchema.nullable(),
  credits: creditsSnapshotSchema.nullable(),
  planType: planTypeSchema.nullable(),
  updatedAt: z.number(),
})
export type Snapshot = z.infer<typeof snapshotSchema>

export const UsageEvent = {
  Updated: BusEvent.define(
    "usage.updated",
    z.object({
      provider: z.string(),
      snapshot: snapshotSchema,
    }),
  ),
}

type UsageProviderInfo = {
  authKeys: string[]
  displayName: string
  requiresOAuth: boolean
}

const usageProviders: Record<string, UsageProviderInfo> = {
  codex: {
    authKeys: ["openai", "codex"],
    displayName: "OpenAI",
    requiresOAuth: true,
  },
  copilot: {
    authKeys: ["github-copilot", "github-copilot-enterprise"],
    displayName: "GitHub Copilot",
    requiresOAuth: true,
  },
}

const providerAliases: Record<string, string> = {
  openai: "codex",
  gpt: "codex",
  chatgpt: "codex",
  "chatgpt-pro": "codex",
  "chatgpt-plus": "codex",
  codex: "codex",
  copilot: "copilot",
  github: "copilot",
  gh: "copilot",
}

const usageEndpoint = "https://chatgpt.com/backend-api/wham/usage"

export const warningThresholds = [75, 90, 95] as const

export async function getUsage(provider: string): Promise<Snapshot | null> {
  return Storage.read<Snapshot>(storageKey(provider)).catch(() => null)
}

export async function updateUsage(provider: string, update: Partial<Snapshot>): Promise<Snapshot> {
  const existing = await getUsage(provider)
  const snapshot: Snapshot = {
    primary: update.primary ?? existing?.primary ?? null,
    secondary: update.secondary ?? existing?.secondary ?? null,
    credits: update.credits ?? existing?.credits ?? null,
    planType: update.planType ?? existing?.planType ?? null,
    updatedAt: Date.now(),
  }
  await Storage.write(storageKey(provider), snapshot)
  await Bus.publish(UsageEvent.Updated, { provider, snapshot }).catch(() => {})
  return snapshot
}

export async function clearUsage(provider: string): Promise<void> {
  await Storage.remove(storageKey(provider))
}

export function resolveProvider(input: string): string | null {
  const normalized = input.trim().toLowerCase()
  return providerAliases[normalized] ?? null
}

export function listSupportedProviders(): string[] {
  return Object.keys(usageProviders)
}

export function getProviderInfo(provider: string): UsageProviderInfo | null {
  return usageProviders[provider] ?? null
}

export async function getAuthenticatedProviders(): Promise<string[]> {
  const auth = await Auth.all()
  const providers = Object.keys(usageProviders)
  const result: string[] = []

  for (const provider of providers) {
    const info = usageProviders[provider]
    const matched = info.authKeys.some((key) => {
      const providerAuth = auth[key]
      if (!providerAuth) return false
      if (info.requiresOAuth && providerAuth.type !== "oauth") return false
      return true
    })
    if (matched) result.push(provider)
  }

  return result
}

export async function getProviderAuth(provider: string): Promise<{ key: string; auth: Auth.Info } | null> {
  const info = usageProviders[provider]
  if (!info) return null
  const auth = await Auth.all()

  for (const key of info.authKeys) {
    const providerAuth = auth[key]
    if (!providerAuth) continue
    if (info.requiresOAuth && providerAuth.type !== "oauth") continue
    return { key, auth: providerAuth }
  }

  return null
}

export function parseRateLimitHeaders(headers: Headers): Snapshot | null {
  const primary = parseWindow(headers, "primary")
  const secondary = parseWindow(headers, "secondary")
  const credits = parseCredits(headers)
  if (!primary && !secondary && !credits) return null

  return {
    primary,
    secondary,
    credits,
    planType: null,
    updatedAt: Date.now(),
  }
}

export async function fetchFromEndpoint(accessToken: string): Promise<Snapshot | null> {
  const response = await fetch(usageEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    log.warn("usage fetch failed", { status: response.status })
    return null
  }

  const body = await response.json().catch(() => null)
  if (!body) return null

  const parsed = usageResponseSchema.safeParse(body)
  if (!parsed.success) {
    log.warn("usage fetch parse failed", { issues: parsed.error.issues.length })
    return null
  }

  const rateLimit = parsed.data.rate_limit
  const primary = toRateLimitWindow(rateLimit.primary_window)
  const secondary = toRateLimitWindow(rateLimit.secondary_window)
  const credits = toCreditsSnapshot(parsed.data.credits)
  const planType = toPlanType(parsed.data.plan_type)

  return {
    primary,
    secondary,
    credits,
    planType,
    updatedAt: Date.now(),
  }
}

export function formatResetTime(resetAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = resetAt - now
  if (diff <= 0) return "now"
  if (diff < 60) return `in ${diff} seconds`
  if (diff < 3600) return `in ${Math.round(diff / 60)} minutes`
  if (diff < 86400) return `in ${Math.round(diff / 3600)} hours`
  return `in ${Math.round(diff / 86400)} days`
}

export function formatWindowDuration(windowMinutes: number): string {
  const minutesPerHour = 60
  const minutesPerDay = 24 * minutesPerHour
  if (windowMinutes <= minutesPerDay) {
    const hours = Math.max(1, Math.round(windowMinutes / minutesPerHour))
    if (hours === 1) return "Hourly"
    return `${hours}h`
  }
  return "Weekly"
}

export function getWarning(snapshot: Snapshot): string | null {
  const windows = [snapshot.primary, snapshot.secondary]
  for (const window of windows) {
    if (!window) continue
    for (const threshold of warningThresholds) {
      if (window.usedPercent < threshold) continue
      const remaining = 100 - window.usedPercent
      const duration = formatWindowDuration(window.windowMinutes ?? 60).toLowerCase()
      return `Less than ${remaining.toFixed(0)}% of your ${duration} limit remaining.`
    }
  }
  return null
}

function storageKey(provider: string): string[] {
  return ["usage", provider]
}

function parseWindow(headers: Headers, prefix: "primary" | "secondary"): RateLimitWindow | null {
  const usedPercent = parseNumberHeader(headers, `x-codex-${prefix}-used-percent`)
  if (usedPercent === null) return null

  return {
    usedPercent,
    windowMinutes: parseIntegerHeader(headers, `x-codex-${prefix}-window-minutes`),
    resetsAt: parseIntegerHeader(headers, `x-codex-${prefix}-reset-at`),
  }
}

function parseCredits(headers: Headers): CreditsSnapshot | null {
  const hasCredits = parseBooleanHeader(headers, "x-codex-credits-has-credits")
  if (hasCredits === null) return null

  return {
    hasCredits,
    unlimited: parseBooleanHeader(headers, "x-codex-credits-unlimited") ?? false,
    balance: headers.get("x-codex-credits-balance"),
  }
}

function parseNumberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) return null
  return parsed
}

function parseIntegerHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return null
  return parsed
}

function parseBooleanHeader(headers: Headers, name: string): boolean | null {
  const value = headers.get(name)
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return null
}

type UsageResponseWindow = {
  used_percent: number
  limit_window_seconds: number
  reset_after_seconds: number
  reset_at: number
}

type UsageResponse = {
  plan_type: string | null
  rate_limit: {
    allowed: boolean
    limit_reached: boolean
    primary_window: UsageResponseWindow | null
    secondary_window: UsageResponseWindow | null
  }
  credits: {
    has_credits: boolean
    unlimited: boolean
    balance: string | null
  } | null
}

const usageResponseWindowSchema = z.object({
  used_percent: z.number(),
  limit_window_seconds: z.number(),
  reset_after_seconds: z.number(),
  reset_at: z.number(),
})

const usageResponseSchema = z.object({
  plan_type: z.string().nullable(),
  rate_limit: z.object({
    allowed: z.boolean(),
    limit_reached: z.boolean(),
    primary_window: usageResponseWindowSchema.nullable(),
    secondary_window: usageResponseWindowSchema.nullable(),
  }),
  credits: z
    .object({
      has_credits: z.boolean(),
      unlimited: z.boolean(),
      balance: z.string().nullable(),
    })
    .nullable(),
}) satisfies z.ZodType<UsageResponse>

function toRateLimitWindow(window: UsageResponseWindow | null): RateLimitWindow | null {
  if (!window) return null
  return {
    usedPercent: window.used_percent,
    windowMinutes: Math.round(window.limit_window_seconds / 60),
    resetsAt: window.reset_at,
  }
}

function toCreditsSnapshot(credits: UsageResponse["credits"]): CreditsSnapshot | null {
  if (!credits) return null
  return {
    hasCredits: credits.has_credits,
    unlimited: credits.unlimited,
    balance: credits.balance,
  }
}

function toPlanType(value: UsageResponse["plan_type"]): PlanType | null {
  if (!value) return null
  const parsed = planTypeSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data
}

type CopilotTokenMetadata = {
  tid?: string
  exp?: number
  sku?: string
  proxyEndpoint?: string
  quotaLimit?: number
  resetDate?: number
}

const COPILOT_SKU_PLAN_MAP: Record<string, PlanType> = {
  free_limited_copilot: "free",
  copilot_for_individual: "pro",
  copilot_individual: "pro",
  copilot_business: "business",
  copilot_enterprise: "enterprise",
  copilot_for_business: "business",
}

export function parseCopilotAccessToken(accessToken: string): CopilotTokenMetadata {
  const result: CopilotTokenMetadata = {}
  const parts = accessToken.split(";")

  for (const part of parts) {
    const eqIndex = part.indexOf("=")
    if (eqIndex === -1) continue
    const key = part.slice(0, eqIndex)
    const value = part.slice(eqIndex + 1)

    switch (key) {
      case "tid":
        result.tid = value
        break
      case "exp":
        result.exp = Number.parseInt(value, 10)
        break
      case "sku":
        result.sku = value
        break
      case "proxy-ep":
        result.proxyEndpoint = value
        break
      case "cq":
        result.quotaLimit = Number.parseInt(value, 10)
        break
      case "rd": {
        const colonIdx = value.indexOf(":")
        if (colonIdx > 0) {
          result.resetDate = Number.parseInt(value.slice(0, colonIdx), 10)
        }
        break
      }
    }
  }

  return result
}

export function copilotSkuToPlan(sku: string | undefined): PlanType | null {
  if (!sku) return null
  return COPILOT_SKU_PLAN_MAP[sku] ?? copilotSkuToPlanType(sku)
}

export function parseCopilotRateLimitHeaders(headers: Headers): Snapshot | null {
  const remainingTokens = parseIntegerHeader(headers, "x-ratelimit-remaining-tokens")
  const remainingRequests = parseIntegerHeader(headers, "x-ratelimit-remaining-requests")

  if (remainingTokens === null && remainingRequests === null) return null

  const estimatedTokenLimit = 10_000_000
  const estimatedRequestLimit = 200_000

  const primary: RateLimitWindow | null =
    remainingTokens !== null
      ? {
          usedPercent: Math.max(
            0,
            Math.min(100, ((estimatedTokenLimit - remainingTokens) / estimatedTokenLimit) * 100),
          ),
          windowMinutes: 60,
          resetsAt: null,
        }
      : null

  const secondary: RateLimitWindow | null =
    remainingRequests !== null
      ? {
          usedPercent: Math.max(
            0,
            Math.min(100, ((estimatedRequestLimit - remainingRequests) / estimatedRequestLimit) * 100),
          ),
          windowMinutes: null,
          resetsAt: null,
        }
      : null

  return {
    primary,
    secondary,
    credits: null,
    planType: null,
    updatedAt: Date.now(),
  }
}

type CopilotAuthInfo = {
  access: string
  refresh: string
}

export async function fetchCopilotUsage(auth: CopilotAuthInfo): Promise<Snapshot | null> {
  const tokenMetadata = parseCopilotAccessToken(auth.access)
  const planType = copilotSkuToPlan(tokenMetadata.sku)

  return {
    primary: null,
    secondary: null,
    credits: tokenMetadata.quotaLimit
      ? {
          hasCredits: true,
          unlimited: false,
          balance: String(tokenMetadata.quotaLimit),
        }
      : null,
    planType,
    updatedAt: Date.now(),
  }
}

function copilotSkuToPlanType(sku: string): PlanType | null {
  const normalized = sku.toLowerCase()
  if (normalized.includes("free")) return "free"
  if (normalized.includes("individual") || normalized.includes("pro")) return "pro"
  if (normalized.includes("business")) return "business"
  if (normalized.includes("enterprise")) return "enterprise"
  return null
}

export const Usage = {
  planTypeSchema,
  rateLimitWindowSchema,
  creditsSnapshotSchema,
  snapshotSchema,
  warningThresholds,
  getUsage,
  updateUsage,
  clearUsage,
  resolveProvider,
  listSupportedProviders,
  getProviderInfo,
  getAuthenticatedProviders,
  getProviderAuth,
  parseRateLimitHeaders,
  fetchFromEndpoint,
  formatResetTime,
  formatWindowDuration,
  getWarning,
  parseCopilotAccessToken,
  parseCopilotRateLimitHeaders,
  copilotSkuToPlan,
  fetchCopilotUsage,
} as const
