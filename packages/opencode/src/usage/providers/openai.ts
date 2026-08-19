import z from "zod"
import { Option, Schema } from "effect"
import { Auth } from "../../auth"
import { iife } from "../../util/iife"
import { planTypeSchema } from "../types"
import type { CreditsSnapshot, PlanType, RateLimitWindow, UsageFetchResult } from "../types"

const endpoint = "https://chatgpt.com/backend-api/wham/usage"

type OpenAIAuth = Extract<Auth.Info, { type: "oauth" }>

const windowSchema = z.object({
  used_percent: z.number(),
  limit_window_seconds: z.number(),
  reset_after_seconds: z.number(),
  reset_at: z.number(),
})

const rateLimitSchema = z.object({
  allowed: z.boolean(),
  limit_reached: z.boolean(),
  primary_window: windowSchema.nullable(),
  secondary_window: windowSchema.nullable(),
})

const responseSchema = z.object({
  plan_type: z.string().nullable(),
  rate_limit: rateLimitSchema.nullish(),
  additional_rate_limits: z
    .array(
      z.object({
        limit_name: z.string(),
        metered_feature: z.string(),
        rate_limit: rateLimitSchema.nullish(),
      }),
    )
    .nullish(),
  spend_control: z
    .object({
      reached: z.boolean(),
      individual_limit: z
        .object({
          limit: z.string(),
          used: z.string(),
          remaining_percent: z.number(),
          reset_at: z.number(),
        })
        .nullish(),
    })
    .nullish(),
  credits: z
    .object({
      has_credits: z.boolean(),
      unlimited: z.boolean(),
      balance: z.string().nullable(),
    })
    .nullish(),
})

type ChatgptUsageResponse = z.infer<typeof responseSchema>
type ChatgptUsageResponseWindow = z.infer<typeof windowSchema>
type ChatgptUsageResponseAdditionalRateLimit = NonNullable<ChatgptUsageResponse["additional_rate_limits"]>[number]

const decodePlanType = Schema.decodeUnknownOption(planTypeSchema)

export async function fetchChatgptUsage(accessToken: string, accountId?: string): Promise<UsageFetchResult> {
  const headers = iife(() => {
    const base = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    }
    if (!accountId) return base
    return { ...base, "ChatGPT-Account-Id": accountId }
  })

  const response = await fetch(endpoint, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    return null
  })

  if (!response) {
    return {
      snapshot: null,
      error: fetchError("OpenAI ChatGPT", "network"),
    }
  }

  if (response.status === 401) {
    return {
      snapshot: null,
      error: {
        kind: "auth",
        message: "OpenAI ChatGPT credentials expired. Send a prompt to refresh them or run: opencode auth login",
      },
    }
  }

  if (!response.ok) {
    return {
      snapshot: null,
      error: fetchError("OpenAI ChatGPT", String(response.status)),
    }
  }

  const body = await response.json().catch(() => null)
  if (!body) {
    return {
      snapshot: null,
      error: fetchError("OpenAI ChatGPT", "empty response"),
    }
  }

  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) {
    return {
      snapshot: null,
      error: fetchError("OpenAI ChatGPT", "parse failed"),
    }
  }

  const rateLimit = parsed.data.rate_limit
  const windows = [
    ...toWindows(rateLimit?.primary_window ?? null, rateLimit?.secondary_window ?? null),
    ...toAdditionalWindows(parsed.data.additional_rate_limits),
    ...toSpendWindows(parsed.data.spend_control),
  ]
  const credits = toCredits(parsed.data.credits) ?? toSpendCredits(parsed.data.spend_control)
  const planType = toPlanType(parsed.data.plan_type)

  return {
    snapshot: {
      windows,
      credits,
      planType,
      updatedAt: Date.now(),
    },
  }
}

export async function fetchChatgptUsageWithAuth(auth: OpenAIAuth): Promise<UsageFetchResult> {
  if (auth.expires > 0 && Date.now() >= auth.expires) {
    return {
      snapshot: null,
      error: {
        kind: "auth",
        message: "OpenAI ChatGPT credentials expired. Send a prompt to refresh them or run: opencode auth login",
      },
    }
  }

  return fetchChatgptUsage(auth.access, auth.accountId)
}

function fetchError(provider: string, detail: string | null) {
  return {
    kind: "transient" as const,
    message: detail ? `${provider} usage request failed (${detail})` : `${provider} usage request failed`,
  }
}

// OpenAI enables and disables rate-limit windows at will, and a remaining
// window can move between the primary and secondary slots (with the 5h window
// disabled, the 7d window arrives as primary_window). Identify windows by
// duration, never by slot position.
function toWindows(
  primary: ChatgptUsageResponseWindow | null,
  secondary: ChatgptUsageResponseWindow | null,
): RateLimitWindow[] {
  const first = toWindow(primary)
  const second = toWindow(secondary)
  const deduped = first && second && first.id === second.id ? { ...second, id: `${second.id}-2` } : second
  return [first, deduped]
    .filter((window): window is RateLimitWindow => window !== null)
    .sort((a, b) => (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0))
}

function toAdditionalWindows(
  limits: readonly ChatgptUsageResponseAdditionalRateLimit[] | null | undefined,
): RateLimitWindow[] {
  return (limits ?? []).flatMap((limit) => {
    if (!limit.rate_limit) return []
    const id = limit.metered_feature.trim()
    const label = limit.limit_name.trim() || id
    if (!id || !label) return []
    return toWindows(limit.rate_limit.primary_window, limit.rate_limit.secondary_window).map((window) => ({
      ...window,
      id: `${id}:${window.id}`,
      label: `${label} ${window.label}`,
    }))
  })
}

function toSpendWindows(spend: ChatgptUsageResponse["spend_control"]): RateLimitWindow[] {
  if (!spend?.individual_limit) return []
  const remainingPercent = Math.min(100, Math.max(0, spend.individual_limit.remaining_percent))
  return [
    {
      id: "monthly-credit-limit",
      label: "Monthly Credit",
      usedPercent: 100 - remainingPercent,
      windowMinutes: null,
      resetsAt: spend.individual_limit.reset_at > 0 ? Math.floor(spend.individual_limit.reset_at) : null,
    },
  ]
}

function toWindow(window: ChatgptUsageResponseWindow | null): RateLimitWindow | null {
  if (!window) return null
  const minutes = Math.round(window.limit_window_seconds / 60)
  // A window without a positive duration is garbage data; drop it rather than
  // fabricating an identity for it.
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const identity = windowIdentity(minutes)
  return {
    id: identity.id,
    label: identity.label,
    usedPercent: window.used_percent,
    windowMinutes: minutes,
    resetsAt: window.reset_at,
  }
}

function windowIdentity(minutes: number): { id: string; label: string } {
  const known: Array<[number, string, string]> = [
    [5 * 60, "5h", "5h"],
    [24 * 60, "daily", "Daily"],
    [7 * 24 * 60, "weekly", "Weekly"],
    [30 * 24 * 60, "monthly", "Monthly"],
  ]
  for (const [duration, id, label] of known) {
    if (Math.abs(minutes - duration) <= duration * 0.1) return { id, label }
  }
  if (minutes < 48 * 60) return { id: `w${minutes}`, label: `${Math.max(1, Math.round(minutes / 60))}h` }
  return { id: `w${minutes}`, label: `${Math.max(1, Math.round(minutes / (24 * 60)))}d` }
}

function toCredits(credits: ChatgptUsageResponse["credits"]): CreditsSnapshot | null {
  if (!credits) return null
  return {
    hasCredits: credits.has_credits,
    unlimited: credits.unlimited,
    balance: credits.balance,
    label: "Credits Balance",
  }
}

function toSpendCredits(spend: ChatgptUsageResponse["spend_control"]): CreditsSnapshot | null {
  if (!spend?.individual_limit) return null
  const total = parseCreditAmount(spend.individual_limit.limit)
  const used = parseCreditAmount(spend.individual_limit.used)
  if (total === null || used === null) return null
  const remaining = Math.max(0, total - used)
  return {
    hasCredits: !spend.reached && remaining > 0,
    unlimited: false,
    balance: String(remaining),
    label: "Monthly Credit Limit",
    total,
    used,
    remaining,
  }
}

function parseCreditAmount(value: string) {
  const normalized = value.trim()
  if (!normalized) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount)
}

function toPlanType(value: ChatgptUsageResponse["plan_type"]): PlanType | null {
  if (!value) return null
  return Option.getOrNull(decodePlanType(value))
}
