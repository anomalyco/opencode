import z from "zod"
import { Auth } from "../../auth"
import type { CreditsSnapshot, RateLimitWindow, UsageFetchResult } from "../types"

const usageEndpoint = "https://api.anthropic.com/api/oauth/usage"

type ClaudeUsageWindow = {
  utilization: number
  resets_at: string | null
}

type ClaudeUsageLimit = {
  kind?: string | null
  group?: string | null
  percent?: number | null
  resets_at?: string | null
  scope?: {
    model?: {
      id?: string | null
      display_name?: string | null
    } | null
  } | null
}

type ClaudeAuth = Extract<Auth.Info, { type: "oauth" }>

const windowSchema = z.object({
  utilization: z.number(),
  resets_at: z.string().nullable(),
})

// Anthropic splits usage into a generic `limits[]` array (session, weekly_all,
// and per-model weekly_scoped buckets such as Fable) while still serving the
// legacy flat keys. `is_active` only marks the currently binding limit — the
// live API reports the enforced session window with is_active:false — so it
// must never be used to filter buckets.
const limitSchema = z.object({
  kind: z.string().nullish(),
  group: z.string().nullish(),
  percent: z.number().nullish(),
  resets_at: z.string().nullish(),
  scope: z
    .object({
      model: z
        .object({
          id: z.string().nullish(),
          display_name: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
})

const responseSchema = z.object({
  five_hour: windowSchema.nullish(),
  seven_day: windowSchema.nullish(),
  // Model-scoped legacy keys still appear (usually null); they are the
  // fallback when the same bucket has no limits[] representation.
  seven_day_opus: windowSchema.nullish(),
  seven_day_sonnet: windowSchema.nullish(),
  limits: z.array(limitSchema).nullish(),
  extra_usage: z
    .object({
      is_enabled: z.boolean().nullish(),
      monthly_limit: z.number().nullish(),
      used_credits: z.number().nullish(),
      utilization: z.number().nullish(),
    })
    .nullish(),
})

type ClaudeUsageResponse = z.infer<typeof responseSchema>

const reauthError = {
  kind: "auth" as const,
  message: "Claude credentials expired. Send a prompt to refresh them or run: opencode auth login",
}

export async function fetchClaudeUsage(auth: ClaudeAuth): Promise<UsageFetchResult> {
  if (auth.expires > 0 && Date.now() >= auth.expires) {
    return { snapshot: null, error: reauthError }
  }

  const response = await requestUsage(auth.access)
  if (!response) {
    return {
      snapshot: null,
      error: fetchError("Claude", "network"),
    }
  }

  if (response.status === 401) {
    return { snapshot: null, error: reauthError }
  }

  if (!response.ok) {
    return {
      snapshot: null,
      error: fetchError("Claude", String(response.status)),
    }
  }

  const body = await response.json().catch(() => null)
  if (!body) {
    return {
      snapshot: null,
      error: fetchError("Claude", "empty response"),
    }
  }

  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) {
    return {
      snapshot: null,
      error: fetchError("Claude", "parse failed"),
    }
  }

  return {
    snapshot: {
      windows: toWindows(parsed.data),
      credits: toCredits(parsed.data.extra_usage),
      planType: null,
      updatedAt: Date.now(),
    },
  }
}

function toWindows(data: ClaudeUsageResponse): RateLimitWindow[] {
  const limits = data.limits ?? []
  const unscoped = (kind: string) =>
    limits.find((limit) => limit.kind === kind && !limit.scope?.model?.display_name?.trim()) ?? null

  // The legacy flat keys are authoritative for the base windows (they carry a
  // known duration); limits[] is the fallback if Anthropic drops them.
  const session = data.five_hour
    ? toWindow("5h", "5h", data.five_hour, 5 * 60)
    : limitWindow("session", "Session", unscoped("session"), null)
  const weekly = data.seven_day
    ? toWindow("weekly", "Weekly", data.seven_day, 7 * 24 * 60)
    : limitWindow("weekly", "Weekly", unscoped("weekly_all"), 7 * 24 * 60)

  const scopedIds = new Set<string>()
  const scoped = limits.flatMap((limit) => {
    const name = limit.scope?.model?.display_name?.trim()
    if (!name) return []
    // kind is authoritative: a weekly_scoped entry stays weekly even when
    // group is missing or renamed.
    const isWeekly = limit.kind === "weekly_scoped" || limit.group === "weekly"
    const id = uniqueWindowId(scopedWindowId(name, isWeekly), scopedIds)
    const window = limitWindow(id, isWeekly ? `${name} Weekly` : name, limit, isWeekly ? 7 * 24 * 60 : null)
    if (!window) return []
    scopedIds.add(id)
    return [window]
  })

  // Dedupe against the canonical (unsuffixed) scoped identity: a legacy model
  // key must not render when the same model already has a scoped entry.
  const legacyScoped = [["Opus", data.seven_day_opus] as const, ["Sonnet", data.seven_day_sonnet] as const].flatMap(
    ([name, window]) => {
      if (!window) return []
      const id = scopedWindowId(name, true)
      if (scopedIds.has(id)) return []
      const result = toWindow(id, `${name} Weekly`, window, 7 * 24 * 60)
      return result ? [result] : []
    },
  )

  return [session, weekly, ...scoped, ...legacyScoped].filter((window): window is RateLimitWindow => window !== null)
}

function scopedWindowId(name: string, weekly: boolean): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return weekly ? `weekly-${slug}` : `scoped-${slug}`
}

// Window ids key the TUI's per-window threshold toasts; duplicate scoped
// entries must not share one id or readings overwrite each other.
function uniqueWindowId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

async function requestUsage(accessToken: string): Promise<Response | null> {
  return fetch(usageEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    return null
  })
}

function fetchError(provider: string, detail: string | null) {
  return {
    kind: "transient" as const,
    message: detail ? `${provider} usage request failed (${detail})` : `${provider} usage request failed`,
  }
}

function parseResetsAt(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 1000)
}

function toWindow(
  id: string,
  label: string,
  window: ClaudeUsageWindow | null | undefined,
  windowMinutes: number | null,
): RateLimitWindow | null {
  if (!window) return null
  return {
    id,
    label,
    usedPercent: window.utilization,
    windowMinutes,
    resetsAt: parseResetsAt(window.resets_at),
  }
}

function limitWindow(
  id: string,
  label: string,
  limit: ClaudeUsageLimit | null,
  windowMinutes: number | null,
): RateLimitWindow | null {
  if (!limit) return null
  if (typeof limit.percent !== "number") return null
  return {
    id,
    label,
    usedPercent: limit.percent,
    windowMinutes,
    resetsAt: parseResetsAt(limit.resets_at),
  }
}

function toCredits(extra: ClaudeUsageResponse["extra_usage"]): CreditsSnapshot | null {
  if (!extra) return null
  if (extra.is_enabled === false) return null

  const limit = typeof extra.monthly_limit === "number" ? extra.monthly_limit : null
  const used = typeof extra.used_credits === "number" ? extra.used_credits : null
  if (limit !== null && used !== null) {
    const remaining = Math.max(0, Math.round((limit - used) * 100) / 100)
    return {
      hasCredits: remaining > 0,
      unlimited: false,
      balance: String(remaining),
      label: "Usage Credits",
    }
  }

  const utilization = typeof extra.utilization === "number" ? extra.utilization : null
  if (utilization !== null) {
    return {
      hasCredits: utilization < 100,
      unlimited: false,
      balance: null,
      label: "Usage Credits",
    }
  }

  return null
}
