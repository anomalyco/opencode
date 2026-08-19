import z from "zod"
import { iife } from "../../util/iife"
import type { PlanType, RateLimitWindow, Snapshot, UsageFetchResult } from "../types"

const usageEndpoint = "https://api.github.com/copilot_internal/user"

const skuPlan: Record<string, PlanType> = {
  free_limited_copilot: "free",
  copilot_for_individual: "pro",
  copilot_individual: "pro",
  copilot_business: "business",
  copilot_enterprise: "enterprise",
  copilot_for_business: "business",
}

const quotaSchema = z.object({
  credits_used: z.number().nullish(),
  entitlement: z.number().nullish(),
  remaining: z.number().nullish(),
  percent_remaining: z.number().nullish(),
  quota_id: z.string().optional(),
  quota_remaining: z.number().nullish(),
  unlimited: z.boolean().optional(),
  has_quota: z.boolean().optional(),
  overage_permitted: z.boolean().optional(),
  token_based_billing: z.boolean().optional(),
})

const responseSchema = z.object({
  quota_snapshots: z.object({
    premium_interactions: quotaSchema.nullish(),
    premium_models: quotaSchema.nullish(),
    chat: quotaSchema.nullish(),
    completions: quotaSchema.nullish(),
  }),
  copilot_plan: z.string().optional(),
  assigned_date: z.string().optional(),
  quota_reset_date: z.string().optional(),
  token_based_billing: z.boolean().optional(),
})

type CopilotTokenMetadata = {
  tid?: string
  exp?: number
  sku?: string
  proxyEndpoint?: string
  quotaLimit?: number
  resetDate?: number
}

type CopilotAuthInfo = {
  access: string
  refresh: string
  enterpriseUrl?: string
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
        result.exp = parseTokenInteger(value)
        break
      case "sku":
        result.sku = value
        break
      case "proxy-ep":
        result.proxyEndpoint = value
        break
      case "cq":
        result.quotaLimit = parseTokenInteger(value)
        break
      case "rd": {
        const colon = value.indexOf(":")
        if (colon > 0) {
          result.resetDate = parseTokenInteger(value.slice(0, colon))
        }
        break
      }
    }
  }

  return result
}

function parseTokenInteger(value: string) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return
  return parsed
}

export function copilotSkuToPlan(sku: string | undefined): PlanType | null {
  if (!sku) return null
  return skuPlan[sku] ?? fallbackPlan(sku)
}

export async function fetchCopilotUsage(auth: CopilotAuthInfo): Promise<UsageFetchResult> {
  const token = parseCopilotAccessToken(auth.access)
  const fallback = snapshotFromToken(token)

  // Usage authenticates with the durable GitHub device token kept in the
  // refresh slot; copilot_internal/user accepts that raw token.
  if (!auth.refresh) {
    return {
      snapshot: fallback,
      error: {
        kind: "auth",
        message: "Copilot usage requires the GitHub token from login. Run: opencode auth login",
      },
    }
  }

  const endpoint = resolveUsageUrl(auth.enterpriseUrl)
  if (!endpoint) {
    return {
      snapshot: fallback,
      error: {
        kind: "auth",
        message: "Copilot enterprise usage requires an HTTPS URL. Run: opencode auth login",
      },
    }
  }

  const response = await fetch(endpoint, {
    method: "GET",
    redirect: "error",
    headers: {
      Authorization: `token ${auth.refresh}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    return null
  })

  if (!response) {
    return {
      snapshot: fallback,
      error: fetchError("Copilot", "network"),
    }
  }

  if (response.status === 401) {
    return {
      snapshot: fallback,
      error: {
        kind: "auth",
        message: "GitHub rejected the Copilot login token. Run: opencode auth login",
      },
    }
  }

  if (!response.ok) {
    return {
      snapshot: fallback,
      error: fetchError("Copilot", String(response.status)),
    }
  }

  const body = await response.json().catch(() => null)
  if (!body) {
    return {
      snapshot: fallback,
      error: fetchError("Copilot", "empty response"),
    }
  }

  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) {
    return {
      snapshot: fallback,
      error: fetchError("Copilot", "parse failed"),
    }
  }

  const data = parsed.data
  // Zeroed counters with has_quota:false are real exhaustion, not a
  // placeholder: a live token-billing business seat at "Monthly Limit: 100%
  // used" on the GitHub dashboard reports exactly percent_remaining 0 and
  // has_quota false here.
  const premium = data.quota_snapshots.premium_models ?? data.quota_snapshots.premium_interactions ?? null
  const tokenBasedBilling = data.token_based_billing ?? premium?.token_based_billing ?? false
  const resetAt = parseResetDate(data.quota_reset_date) ?? token.resetDate ?? null
  const planType = copilotSkuToPlan(data.copilot_plan) ?? copilotSkuToPlan(token.sku)
  const creditsUsed =
    [
      data.quota_snapshots.premium_interactions,
      data.quota_snapshots.premium_models,
      data.quota_snapshots.chat,
      data.quota_snapshots.completions,
    ]
      .map((snapshot) => creditAmount(snapshot?.credits_used))
      .find((value) => value !== null) ?? null
  const usageCounts = iife(() => {
    if (!premium) return null
    const total = creditCount(premium.entitlement)
    const remaining = creditCount(premium.quota_remaining ?? premium.remaining)
    if (total === null || remaining === null) return null
    const used = Math.max(0, total - remaining)
    return {
      total,
      used,
      remaining,
    }
  })

  const primary: RateLimitWindow | null = iife(() => {
    if (!premium) return null
    const usedPercent = iife(() => {
      if (typeof premium.percent_remaining === "number") return 100 - premium.percent_remaining
      if (!usageCounts || usageCounts.total === 0) return null
      return (usageCounts.used / usageCounts.total) * 100
    })
    if (usedPercent === null) return null
    return {
      id: "monthly",
      label: "Monthly",
      usedPercent: clampPercent(usedPercent),
      windowMinutes: null,
      resetsAt: resetAt,
    }
  })

  const quota = iife(() => {
    if (usageCounts) return usageCounts.remaining
    if (premium) return creditCount(premium.quota_remaining ?? premium.remaining)
    return token.quotaLimit ?? null
  })

  const unlimited = premium?.unlimited ?? false
  const credits =
    quota !== null || unlimited || creditsUsed !== null
      ? {
          hasCredits: unlimited || (quota ?? 0) > 0,
          unlimited,
          balance: creditsUsed !== null || quota === null ? null : String(quota),
          label: tokenBasedBilling || creditsUsed !== null ? "GitHub AI Credits" : "Premium Requests",
          overagePermitted: premium?.overage_permitted,
          total: creditsUsed === null ? (usageCounts?.total ?? null) : null,
          used: creditsUsed ?? usageCounts?.used ?? null,
          remaining: creditsUsed === null ? (usageCounts?.remaining ?? quota) : null,
        }
      : null

  return {
    snapshot: {
      windows: primary ? [primary] : [],
      credits,
      planType,
      updatedAt: Date.now(),
    },
  }
}

function fetchError(provider: string, detail: string | null) {
  return {
    kind: "transient" as const,
    message: detail ? `${provider} usage request failed (${detail})` : `${provider} usage request failed`,
  }
}

function resolveUsageUrl(enterpriseUrl: string | undefined): string | null {
  if (!enterpriseUrl) return usageEndpoint
  const value = enterpriseUrl.includes("://") ? enterpriseUrl : `https://${enterpriseUrl}`
  if (!URL.canParse(value)) return null
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password) return null
  const base = url.pathname.replace(/\/$/, "")
  url.pathname = base.endsWith("/api/v3") ? `${base}/copilot_internal/user` : `${base}/api/v3/copilot_internal/user`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function parseResetDate(value: string | undefined): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 1000)
}

function snapshotFromToken(token: CopilotTokenMetadata): Snapshot | null {
  const planType = copilotSkuToPlan(token.sku)
  const quotaLimit = typeof token.quotaLimit === "number" && Number.isFinite(token.quotaLimit) ? token.quotaLimit : null
  const credits =
    quotaLimit !== null
      ? {
          hasCredits: quotaLimit > 0,
          unlimited: false,
          balance: String(quotaLimit),
          label: "Premium Requests",
          total: null,
          used: null,
          remaining: quotaLimit,
        }
      : null

  if (!credits && !planType) return null

  return {
    windows: [],
    credits,
    planType,
    updatedAt: Date.now(),
  }
}

function fallbackPlan(sku: string): PlanType | null {
  const normalized = sku.toLowerCase()
  if (normalized.includes("free")) return "free"
  if (normalized.includes("individual") || normalized.includes("pro")) return "pro"
  if (normalized.includes("business")) return "business"
  if (normalized.includes("enterprise")) return "enterprise"
  return null
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function creditCount(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function creditAmount(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value)) return null
  return Math.max(0, value)
}
