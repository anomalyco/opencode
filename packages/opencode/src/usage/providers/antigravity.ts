import z from "zod"
import { Auth } from "../../auth"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import type { RateLimitWindow, UsageFetchResult } from "../types"

const quotaEndpoint = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
const cacheTtlMs = 30 * 60 * 1000

type AntigravityAuth = Extract<Auth.Info, { type: "oauth" }>
type RefreshParts = {
  refreshToken?: string
  projectId?: string
  managedProjectId?: string
}
type QuotaGroup = "claude" | "gemini-pro" | "gemini-flash"
type QuotaGroupSummary = {
  remainingFraction: number
  resetTime?: string | number
}

const reauthError = {
  kind: "auth" as const,
  message: "Google Antigravity credentials expired. Send a prompt to refresh them or re-login.",
}

const modelSchema = z.object({
  displayName: z.string().nullish(),
  modelName: z.string().nullish(),
  quotaInfo: z
    .object({
      remainingFraction: z.number().nullish(),
      resetTime: z.string().nullish(),
    })
    .nullish(),
})
const responseSchema = z.object({
  models: z.record(z.string(), modelSchema).nullish(),
})
const cachedQuotaSchema = z.object({
  remainingFraction: z.number().nullish(),
  resetTime: z.union([z.string(), z.number()]).nullish(),
  modelCount: z.number().nullish(),
})
const accountSchema = z.object({
  refreshToken: z.string().nullish(),
  projectId: z.string().nullish(),
  managedProjectId: z.string().nullish(),
  enabled: z.boolean().nullish(),
  cachedQuota: z.record(z.string(), cachedQuotaSchema).nullish(),
  cachedQuotaUpdatedAt: z.number().nullish(),
  rateLimitResetTimes: z.record(z.string(), z.number().nullish()).nullish(),
})
const accountsSchema = z.object({
  version: z.literal(4),
  accounts: z.array(accountSchema).nullish(),
  activeIndex: z.number().nullish(),
  activeIndexByFamily: z
    .object({
      claude: z.number().nullish(),
      gemini: z.number().nullish(),
    })
    .nullish(),
})

export async function fetchAntigravityUsageWithAuth(auth: AntigravityAuth): Promise<UsageFetchResult> {
  const cached = await fetchCachedAntigravityUsage(auth.refresh)
  if (!auth.access) {
    if (cached) return cached
    return {
      snapshot: null,
      error: fetchError("Google Antigravity", "missing access token and cached quota"),
    }
  }

  if (auth.expires > 0 && Date.now() >= auth.expires) {
    return cached ? { ...cached, error: reauthError } : { snapshot: null, error: reauthError }
  }

  const parts = parseRefreshParts(auth.refresh)
  return fetchAntigravityUsage(auth.access, parts.managedProjectId ?? parts.projectId)
}

async function fetchAntigravityUsage(accessToken: string, projectId: string | undefined): Promise<UsageFetchResult> {
  const response = await fetch(quotaEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": antigravityUserAgent(),
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": antigravityClientMetadata(),
    },
    body: JSON.stringify(projectId ? { project: projectId } : {}),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    return null
  })

  if (!response) {
    return {
      snapshot: null,
      error: fetchError("Google Antigravity", "network"),
    }
  }

  if (response.status === 401) {
    return {
      snapshot: null,
      error: {
        kind: "auth",
        message: "Google Antigravity credentials expired. Send a prompt to refresh them or re-login.",
      },
    }
  }

  if (!response.ok) {
    return {
      snapshot: null,
      error: fetchError("Google Antigravity", String(response.status)),
    }
  }

  const body = await response.json().catch(() => null)
  if (!body) {
    return {
      snapshot: null,
      error: fetchError("Google Antigravity", "empty response"),
    }
  }

  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) {
    return {
      snapshot: null,
      error: fetchError("Google Antigravity", "parse failed"),
    }
  }

  const groups = aggregateQuota(parsed.data.models)
  if (!groups.claude && !groups["gemini-pro"] && !groups["gemini-flash"]) {
    return {
      snapshot: null,
      error: fetchError("Google Antigravity", "no quota information available"),
    }
  }

  return {
    snapshot: {
      windows: [
        toWindow("claude-opus", "Claude Opus", groups.claude),
        toWindow("gemini-pro", "Gemini Pro", groups["gemini-pro"]),
        toWindow("gemini-flash", "Gemini Flash", groups["gemini-flash"]),
      ].filter((window): window is RateLimitWindow => window !== null),
      credits: null,
      planType: null,
      updatedAt: Date.now(),
    },
  }
}

function aggregateQuota(models: Record<string, z.infer<typeof modelSchema>> | null | undefined) {
  return Object.entries(models ?? {}).reduce<Partial<Record<QuotaGroup, QuotaGroupSummary>>>(
    (groups, [name, entry]) => {
      const group = classifyQuotaGroup(name, entry.displayName ?? entry.modelName ?? undefined)
      if (!group || !entry.quotaInfo) return groups

      const remainingFraction = normalizeRemainingFraction(entry.quotaInfo.remainingFraction)
      if (remainingFraction === null) return groups
      const resetTime = entry.quotaInfo.resetTime ?? undefined
      const existing = groups[group]
      if (existing && remainingFraction > existing.remainingFraction) return groups
      return {
        ...groups,
        [group]: {
          remainingFraction,
          resetTime:
            existing && remainingFraction === existing.remainingFraction
              ? earlierResetTime(existing.resetTime, resetTime)
              : resetTime,
        },
      }
    },
    {},
  )
}

function classifyQuotaGroup(modelName: string, displayName: string | undefined): QuotaGroup | null {
  const combined = `${modelName} ${displayName ?? ""}`.toLowerCase()
  if (combined.includes("claude")) return "claude"
  if (!combined.includes("gemini")) return null
  if (combined.includes("flash")) return "gemini-flash"
  return "gemini-pro"
}

function toWindow(id: string, label: string, group: QuotaGroupSummary | undefined): RateLimitWindow | null {
  if (!group) return null
  return {
    id,
    label,
    usedPercent: 100 - group.remainingFraction * 100,
    windowMinutes: null,
    resetsAt: parseResetTime(group.resetTime),
  }
}

async function fetchCachedAntigravityUsage(refresh: string): Promise<UsageFetchResult | null> {
  const storage = await loadAccountStorage()
  if (!storage?.accounts?.length) return null

  const parts = parseRefreshParts(refresh)
  const fallback = storage.accounts.find(
    (account) => account.enabled !== false && parts.refreshToken && account.refreshToken === parts.refreshToken,
  )
  const claude = cachedQuotaForAccount(resolveCachedAccount(storage, "claude") ?? fallback, "claude")
  const gemini = resolveCachedAccount(storage, "gemini") ?? fallback
  const secondary = cachedQuotaForAccount(gemini, "gemini-pro")
  const tertiary = cachedQuotaForAccount(gemini, "gemini-flash")
  const quotas = [claude, secondary, tertiary].filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  if (quotas.length === 0) return null
  const now = Date.now()
  const timestamps = quotas.map((entry) => normalizeCacheTimestamp(entry.updatedAt))
  const updatedAt = timestamps.filter((value): value is number => value !== null)
  const stale = timestamps.some((value) => value === null || value > now || now - value > cacheTtlMs)
  return {
    snapshot: {
      windows: [
        toWindow("claude-opus", "Claude Opus", claude?.quota),
        toWindow("gemini-pro", "Gemini Pro", secondary?.quota),
        toWindow("gemini-flash", "Gemini Flash", tertiary?.quota),
      ].filter((window): window is RateLimitWindow => window !== null),
      credits: null,
      planType: null,
      updatedAt: updatedAt.length > 0 ? Math.max(...updatedAt) : 0,
    },
    cacheable: false,
    ...(stale ? { error: fetchError("Google Antigravity", "cached quota is stale") } : {}),
  }
}

async function loadAccountStorage(): Promise<z.infer<typeof accountsSchema> | null> {
  const file = Bun.file(path.join(Global.Path.config, "antigravity-accounts.json"))
  if (!(await file.exists())) return null
  const parsed = accountsSchema.safeParse(await file.json().catch(() => null))
  if (!parsed.success) return null
  return parsed.data
}

function resolveCachedAccount(storage: z.infer<typeof accountsSchema>, family: "claude" | "gemini") {
  const index = storage.activeIndexByFamily?.[family] ?? storage.activeIndex ?? 0
  if (!Number.isInteger(index) || index < 0) return null
  const account = storage.accounts?.[index]
  if (!account || account.enabled === false) return null
  return account
}

function cachedQuotaForAccount(account: z.infer<typeof accountSchema> | null | undefined, group: QuotaGroup) {
  const rateLimitResetAt = futureRateLimitResetAt(account, group)
  if (rateLimitResetAt) {
    return {
      quota: {
        remainingFraction: 0,
        resetTime: rateLimitResetAt,
      },
      updatedAt: account?.cachedQuotaUpdatedAt,
    }
  }

  const quota = account?.cachedQuota?.[group]
  if (!quota) return null
  const resetAt = parseResetTime(quota.resetTime ?? undefined)
  const updatedAt = normalizeResetTimestamp(account.cachedQuotaUpdatedAt)
  if (resetAt !== null && resetAt <= Math.floor(Date.now() / 1000) && (updatedAt === null || updatedAt < resetAt))
    return null
  const remainingFraction = normalizeRemainingFraction(quota.remainingFraction)
  if (remainingFraction === null) return null
  return {
    quota: {
      remainingFraction,
      resetTime: futureCachedResetTime(quota.resetTime),
    },
    updatedAt: account.cachedQuotaUpdatedAt,
  }
}

function futureRateLimitResetAt(account: z.infer<typeof accountSchema> | null | undefined, group: QuotaGroup) {
  const now = Math.floor(Date.now() / 1000)
  if (group === "claude") {
    const resetAt = normalizeResetTimestamp(account?.rateLimitResetTimes?.claude)
    return resetAt !== null && resetAt > now ? resetAt : null
  }

  const limits = ["gemini-antigravity", "gemini-cli"].map((style) => geminiRateLimits(account, style, group, now))
  const baseResets = limits.map((limit) => limit.base).filter((value): value is number => value !== null)
  const models = new Set(limits.flatMap((limit) => [...limit.models.keys()]))
  const modelResets = [...models].flatMap((model) => {
    const resets = limits
      .map((limit) => latestReset(limit.base, limit.models.get(model)))
      .filter((value): value is number => value !== null)
    if (resets.length !== limits.length) return []
    return [Math.min(...resets)]
  })
  return (
    [...(baseResets.length === limits.length ? [Math.min(...baseResets)] : []), ...modelResets].sort(
      (left, right) => left - right,
    )[0] ?? null
  )
}

function geminiRateLimits(
  account: z.infer<typeof accountSchema> | null | undefined,
  style: string,
  group: Exclude<QuotaGroup, "claude">,
  now: number,
) {
  const limits = Object.entries(account?.rateLimitResetTimes ?? {}).flatMap(([key, value]) => {
    if (key !== style && !key.startsWith(`${style}:`)) return []
    const resetAt = normalizeResetTimestamp(value)
    if (resetAt === null || resetAt <= now) return []
    return [[key, resetAt] as const]
  })
  return {
    base: limits.find(([key]) => key === style)?.[1] ?? null,
    models: new Map(
      limits.flatMap(([key, resetAt]) => {
        if (key === style || !rateLimitKeyMatchesGroup(key, group)) return []
        return [[key.slice(style.length + 1), resetAt] as const]
      }),
    ),
  }
}

function rateLimitKeyMatchesGroup(key: string, group: Exclude<QuotaGroup, "claude">) {
  const model = key.slice(key.indexOf(":") + 1).toLowerCase()
  return group === "gemini-flash" ? model.includes("flash") : !model.includes("flash")
}

function latestReset(base: number | null, model: number | undefined) {
  if (model === undefined) return base
  if (base === null) return model
  return Math.max(base, model)
}

function futureCachedResetTime(value: string | number | null | undefined) {
  const resetAt = parseResetTime(value ?? undefined)
  if (resetAt === null) return undefined
  if (resetAt <= Math.floor(Date.now() / 1000)) return undefined
  return resetAt
}

function normalizeRemainingFraction(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function earlierResetTime(left: string | number | undefined, right: string | number | undefined) {
  if (!right) return left
  if (!left) return right
  const leftSeconds = parseResetTime(left)
  const rightSeconds = parseResetTime(right)
  if (leftSeconds === null) return right
  if (rightSeconds === null) return left
  return rightSeconds < leftSeconds ? right : left
}

function parseResetTime(value: string | number | undefined) {
  if (!value) return null
  if (typeof value === "number") return normalizeResetTimestamp(value)
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 1000)
}

function normalizeResetTimestamp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.floor(value > 1_000_000_000_000 ? value / 1000 : value)
}

function normalizeCacheTimestamp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.floor(value < 1_000_000_000_000 ? value * 1000 : value)
}

function parseRefreshParts(refresh: string): RefreshParts {
  const [refreshToken = "", projectId = "", managedProjectId = ""] = refresh.split("|")
  return {
    ...(refreshToken ? { refreshToken } : {}),
    ...(projectId ? { projectId } : {}),
    ...(managedProjectId ? { managedProjectId } : {}),
  }
}

function fetchError(provider: string, detail: string | null) {
  return {
    kind: "transient" as const,
    message: detail ? `${provider} usage request failed (${detail})` : `${provider} usage request failed`,
  }
}

function antigravityClientMetadata() {
  return `{"ideType":"ANTIGRAVITY","platform":"${process.platform === "win32" ? "WINDOWS" : "MACOS"}","pluginType":"GEMINI"}`
}

function antigravityUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.18.3 Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36"
}
