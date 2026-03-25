import path from "path"
import os from "os"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Auth } from "../../auth"
import { UI } from "../ui"

interface UsageWindow {
  usedPercent: number | null
  remainingPercent: number | null
  windowSeconds: number | null
  resetAfterSeconds: number | null
  resetAt: number | null
  resetAtFormatted: string | null
  resetAfterFormatted: string | null
  valueLabel?: string | null
}

interface ProviderUsage {
  windows: Record<string, UsageWindow>
  models?: Record<string, ProviderUsage>
}

interface QuotaProviderResult {
  providerId: string
  providerName: string
  ok: boolean
  configured: boolean
  usage: ProviderUsage | null
  error: string | null
  fetchedAt: number
}

// Antigravity account storage
interface AntigravityAccount {
  email?: string
  refreshToken: string
  projectId?: string
  managedProjectId?: string
  addedAt: number
  lastUsed: number
  enabled?: boolean
}

interface AntigravityStorage {
  version: number
  accounts: AntigravityAccount[]
  activeIndex: number
}

const getAntigravityStoragePath = (): string => {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdgConfig, "opencode", "antigravity-accounts.json")
}

const loadAntigravityAccounts = async (): Promise<AntigravityAccount[]> => {
  try {
    const filePath = getAntigravityStoragePath()
    const content = await Bun.file(filePath).text()
    const storage: AntigravityStorage = JSON.parse(content)
    if (storage.version >= 3 && Array.isArray(storage.accounts)) {
      return storage.accounts.filter((a) => a.enabled !== false && a.refreshToken)
    }
    return []
  } catch {
    return []
  }
}

// Utility functions (from openchamber's utils)
const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const toTimestamp = (value: unknown): number | null => {
  if (!value) return null
  if (typeof value === "number") return value < 1_000_000_000_000 ? value * 1000 : value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

// Helper to create a UsageWindow with usedPercent -> remaining calculation
const toQuotaWindow = (usedPercent: number | null, resetAt: number | null): UsageWindow => ({
  usedPercent,
  remainingPercent: usedPercent !== null ? 100 - usedPercent : null,
  windowSeconds: null,
  resetAfterSeconds: resetAt !== null ? Math.max(0, resetAt - Date.now()) / 1000 : null,
  resetAt,
  resetAtFormatted: resetAt !== null ? new Date(resetAt).toLocaleString() : null,
  resetAfterFormatted: null,
  valueLabel: null,
})

// Parse refresh token (format: token|projectId|managedProjectId)
const parseRefreshToken = (raw: string) => {
  if (!raw) return { refreshToken: null, projectId: null }
  const parts = raw.split("|")
  return { refreshToken: parts[0] || null, projectId: parts[1] || null }
}

const buildResult = (input: {
  providerId: string
  providerName: string
  ok: boolean
  configured: boolean
  usage?: ProviderUsage
  error?: string
}): QuotaProviderResult => ({
  ...input,
  usage: input.usage ?? null,
  error: input.error ?? null,
  fetchedAt: Date.now(),
})

const toUsageWindow = (input: {
  usedPercent: number | null
  windowSeconds: number | null
  resetAt: number | null
  valueLabel?: string | null
}): UsageWindow => {
  const used = toNumber(input.usedPercent)
  const remaining = used !== null ? 100 - used : null

  const resetAtFormatted = input.resetAt !== null ? new Date(input.resetAt).toLocaleString() : null

  return {
    usedPercent: used,
    remainingPercent: remaining,
    windowSeconds: toNumber(input.windowSeconds),
    resetAfterSeconds: input.resetAt !== null ? Math.max(0, input.resetAt - Date.now()) / 1000 : null,
    resetAt: input.resetAt,
    resetAtFormatted,
    resetAfterFormatted: null,
    valueLabel: input.valueLabel,
  }
}

// Provider implementations
interface QuotaProviderModule {
  providerId: string
  providerName: string
  aliases: string[]
  isConfigured: (auth: Auth.Info | undefined) => boolean | Promise<boolean>
  fetchQuota: (auth: Auth.Info | undefined) => Promise<QuotaProviderResult>
}

const claudeProvider: QuotaProviderModule = {
  providerId: "claude",
  providerName: "Claude",
  aliases: ["anthropic", "claude"],
  isConfigured: (auth) => Boolean(auth?.type === "oauth" || auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth) {
      return buildResult({
        providerId: "claude",
        providerName: "Claude",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const accessToken = auth.type === "oauth" ? auth.access : auth.type === "api" ? auth.key : null
    if (!accessToken) {
      return buildResult({
        providerId: "claude",
        providerName: "Claude",
        ok: false,
        configured: false,
        error: "No access token",
      })
    }

    try {
      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "claude",
          providerName: "Claude",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      const fiveHour = payload?.five_hour
      const sevenDay = payload?.seven_day
      const sevenDaySonnet = payload?.seven_day_sonnet
      const sevenDayOpus = payload?.seven_day_opus

      if (fiveHour) {
        windows["5h"] = toUsageWindow({
          usedPercent: toNumber(fiveHour.utilization),
          windowSeconds: null,
          resetAt: toTimestamp(fiveHour.resets_at),
        })
      }
      if (sevenDay) {
        windows["7d"] = toUsageWindow({
          usedPercent: toNumber(sevenDay.utilization),
          windowSeconds: null,
          resetAt: toTimestamp(sevenDay.resets_at),
        })
      }
      if (sevenDaySonnet) {
        windows["7d-sonnet"] = toUsageWindow({
          usedPercent: toNumber(sevenDaySonnet.utilization),
          windowSeconds: null,
          resetAt: toTimestamp(sevenDaySonnet.resets_at),
        })
      }
      if (sevenDayOpus) {
        windows["7d-opus"] = toUsageWindow({
          usedPercent: toNumber(sevenDayOpus.utilization),
          windowSeconds: null,
          resetAt: toTimestamp(sevenDayOpus.resets_at),
        })
      }

      return buildResult({
        providerId: "claude",
        providerName: "Claude",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "claude",
        providerName: "Claude",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const codexProvider: QuotaProviderModule = {
  providerId: "codex",
  providerName: "Codex",
  aliases: ["openai", "codex", "chatgpt"],
  isConfigured: (auth) => Boolean(auth?.type === "oauth" || auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth) {
      return buildResult({
        providerId: "codex",
        providerName: "Codex",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const accessToken = auth.type === "oauth" ? auth.access : auth.type === "api" ? auth.key : null
    const accountId = auth.type === "oauth" ? auth.accountId : null
    if (!accessToken) {
      return buildResult({
        providerId: "codex",
        providerName: "Codex",
        ok: false,
        configured: false,
        error: "No access token",
      })
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      }
      if (accountId) headers["ChatGPT-Account-Id"] = accountId

      const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { method: "GET", headers })

      if (!response.ok) {
        const errorMsg =
          response.status === 401
            ? "Session expired — please re-authenticate with OpenAI"
            : `API error: ${response.status}`
        return buildResult({ providerId: "codex", providerName: "Codex", ok: false, configured: true, error: errorMsg })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      const primary = payload?.rate_limit?.primary_window
      const secondary = payload?.rate_limit?.secondary_window
      const credits = payload?.credits

      if (primary) {
        windows["5h"] = toUsageWindow({
          usedPercent: toNumber(primary.used_percent),
          windowSeconds: toNumber(primary.limit_window_seconds),
          resetAt: toTimestamp(primary.reset_at),
        })
      }
      if (secondary) {
        windows["weekly"] = toUsageWindow({
          usedPercent: toNumber(secondary.used_percent),
          windowSeconds: toNumber(secondary.limit_window_seconds),
          resetAt: toTimestamp(secondary.reset_at),
        })
      }
      if (credits) {
        const balance = toNumber(credits.balance)
        const unlimited = Boolean(credits.unlimited)
        const label = unlimited ? "Unlimited" : balance !== null ? `$${balance.toFixed(2)} remaining` : null
        windows["credits"] = toUsageWindow({ usedPercent: null, windowSeconds: null, resetAt: null, valueLabel: label })
      }

      return buildResult({ providerId: "codex", providerName: "Codex", ok: true, configured: true, usage: { windows } })
    } catch (e) {
      return buildResult({
        providerId: "codex",
        providerName: "Codex",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

// Google OAuth credentials for installed application
// It's ok to save this in git because this is an installed application
// as described here: https://developers.google.com/identity/protocols/oauth2#installed
// "The process results in a client ID and, in some cases, a client secret,
// which you embed in the source code of your application. (In this context,
// the client secret is obviously not treated as a secret.)"
const GOOGLE_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
const GOOGLE_CLIENT_SECRET = "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"

const refreshGoogleAccessToken = async (
  refreshToken: string,
  clientId: string = GOOGLE_CLIENT_ID,
  clientSecret: string = GOOGLE_CLIENT_SECRET,
): Promise<string | null> => {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    })

    if (!response.ok) return null
    const data = await response.json()
    return typeof data?.access_token === "string" ? data.access_token : null
  } catch {
    return null
  }
}

interface GoogleModelEntry {
  quotaInfo?: {
    remainingFraction?: number
    resetTime?: string
  }
  displayName?: string
  modelName?: string
}

interface GoogleQuotaResponse {
  models?: Record<string, GoogleModelEntry>
}

interface GeminiCliBucket {
  modelId?: string
  remainingFraction?: number
  resetTime?: string
}

interface GeminiCliQuotaResponse {
  buckets?: GeminiCliBucket[]
}

const fetchGoogleQuota = async (accessToken: string): Promise<GoogleQuotaResponse | null> => {
  const endpoints = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://autopush-cloudcode-pa.sandbox.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "antigravity/1.11.5 windows/amd64",
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      })

      if (response.ok) {
        return await response.json()
      }
    } catch {
      continue
    }
  }
  return null
}

const fetchGeminiCliQuota = async (accessToken: string): Promise<GeminiCliQuotaResponse | null> => {
  const endpoints = [
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://autopush-cloudcode-pa.sandbox.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]

  // Use Gemini CLI user-agent to get CLI quota buckets
  const platform = process.platform || "darwin"
  const arch = process.arch || "arm64"
  const geminiCliUserAgent = `GeminiCLI/1.0.0/gemini-2.5-pro (${platform}; ${arch})`

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/v1internal:retrieveUserQuota`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": geminiCliUserAgent,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      })

      if (response.ok) {
        return await response.json()
      }
    } catch {
      continue
    }
  }
  return null
}

const googleProvider: QuotaProviderModule = {
  providerId: "google",
  providerName: "Google",
  aliases: ["google", "gemini"],
  isConfigured: async () => {
    // Check Antigravity accounts first
    const accounts = await loadAntigravityAccounts()
    if (accounts.length > 0) return true
    // Fall back to built-in auth
    const authMap = await Auth.all()
    return Boolean(
      authMap.google?.type === "oauth" || authMap.google?.type === "api" || authMap.google?.type === "wellknown",
    )
  },
  fetchQuota: async (auth) => {
    // Try Antigravity accounts first
    const accounts = await loadAntigravityAccounts()
    if (accounts.length > 0) {
      // Use the active account
      const account = accounts[0]
      const parsed = parseRefreshToken(account.refreshToken)
      let accessToken: string | null = null

      // Try to refresh token
      if (parsed.refreshToken) {
        accessToken = await refreshGoogleAccessToken(parsed.refreshToken)
      }

      if (!accessToken) {
        return buildResult({
          providerId: "google",
          providerName: "Google",
          ok: false,
          configured: true,
          error: `Failed to refresh token for ${account.email || "Antigravity account"}`,
        })
      }

      try {
        // Fetch both Antigravity and Gemini CLI quotas in parallel
        const [payload, geminiCliPayload] = await Promise.all([
          fetchGoogleQuota(accessToken),
          fetchGeminiCliQuota(accessToken),
        ])

        if (!payload) {
          return buildResult({
            providerId: "google",
            providerName: "Google",
            ok: false,
            configured: true,
            error: "Failed to fetch models",
          })
        }

        const windows: Record<string, UsageWindow> = {}

        // Parse Antigravity model quotas
        const antigravityPatterns = ["gemini-3", "claude-", "gpt-"]
        for (const [modelName, modelData] of Object.entries(payload?.models ?? {})) {
          if (!antigravityPatterns.some((p) => modelName.includes(p))) continue
          const quotaInfo = modelData.quotaInfo
          if (!quotaInfo || typeof quotaInfo.remainingFraction !== "number") continue
          const name = modelName.startsWith("antigravity/") ? modelName.replace("antigravity/", "") : modelName
          windows[`(Antigravity) ${name}`] = toQuotaWindow(
            Math.round((1 - quotaInfo.remainingFraction) * 100),
            toTimestamp(quotaInfo.resetTime),
          )
        }

        // Parse Gemini CLI quota buckets
        for (const bucket of geminiCliPayload?.buckets ?? []) {
          const isRelevant = bucket.modelId?.startsWith("gemini-3-") || bucket.modelId === "gemini-2.5-pro"
          if (!isRelevant || typeof bucket.remainingFraction !== "number") continue
          windows[`(Gemini CLI) ${bucket.modelId}`] = toQuotaWindow(
            Math.round((1 - bucket.remainingFraction) * 100),
            toTimestamp(bucket.resetTime),
          )
        }

        return buildResult({
          providerId: "google",
          providerName: "Google",
          ok: true,
          configured: true,
          usage: { windows: Object.keys(windows).length ? windows : { quota: toQuotaWindow(null, null) } },
        })
      } catch (e) {
        return buildResult({
          providerId: "google",
          providerName: "Google",
          ok: false,
          configured: true,
          error: e instanceof Error ? e.message : "Request failed",
        })
      }
    }

    // Fall back to built-in auth
    if (!auth)
      return buildResult({
        providerId: "google",
        providerName: "Google",
        ok: false,
        configured: false,
        error: "Not configured",
      })

    let accessToken: string | null = null
    if (auth.type === "oauth") {
      const parsed = parseRefreshToken(auth.refresh)
      accessToken = auth.access || (parsed.refreshToken ? await refreshGoogleAccessToken(parsed.refreshToken) : null)
    } else if (auth.type === "api") {
      accessToken = auth.key
    } else if (auth.type === "wellknown") {
      accessToken = auth.token
    }

    if (!accessToken)
      return buildResult({
        providerId: "google",
        providerName: "Google",
        ok: false,
        configured: false,
        error: "No access token",
      })

    try {
      const payload = await fetchGoogleQuota(accessToken)
      if (!payload)
        return buildResult({
          providerId: "google",
          providerName: "Google",
          ok: false,
          configured: true,
          error: "Failed to fetch models",
        })

      const windows: Record<string, UsageWindow> = payload?.models ? { quota: toQuotaWindow(null, null) } : {}
      return buildResult({
        providerId: "google",
        providerName: "Google",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "google",
        providerName: "Google",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const zaiProvider: QuotaProviderModule = {
  providerId: "zai-coding-plan",
  providerName: "Z.AI Coding Plan",
  aliases: ["zai-coding-plan", "zai", "z.ai"],
  isConfigured: (auth) => Boolean(auth?.type === "api" || auth?.type === "wellknown"),
  fetchQuota: async (auth) => {
    if (!auth) {
      return buildResult({
        providerId: "zai-coding-plan",
        providerName: "Z.AI Coding Plan",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const apiKey = auth.type === "api" ? auth.key : auth.type === "wellknown" ? auth.token : null
    if (!apiKey) {
      return buildResult({
        providerId: "zai-coding-plan",
        providerName: "Z.AI Coding Plan",
        ok: false,
        configured: false,
        error: "No API key",
      })
    }

    try {
      const response = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "zai-coding-plan",
          providerName: "Z.AI Coding Plan",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : []
      const tokensLimit = limits.find((l: Record<string, unknown>) => l?.type === "TOKENS_LIMIT")

      const resolveWindowSeconds = (limit: Record<string, unknown> | undefined) => {
        const unitSeconds: Record<number, number> = { 3: 3600 }
        if (!limit || typeof limit.number !== "number") return null
        const us = unitSeconds[limit.unit as number]
        return us ? us * (limit.number as number) : null
      }

      const resolveWindowLabel = (seconds: number | null) => {
        if (!seconds) return "tokens"
        if (seconds % 86400 === 0) return seconds / 86400 === 7 ? "weekly" : `${seconds / 86400}d`
        if (seconds % 3600 === 0) return `${seconds / 3600}h`
        return `${seconds}s`
      }

      const windowSeconds = resolveWindowSeconds(tokensLimit)
      const windowLabel = resolveWindowLabel(windowSeconds)
      const resetAt = tokensLimit?.nextResetTime ? toTimestamp(tokensLimit.nextResetTime) : null
      const usedPercent = typeof tokensLimit?.percentage === "number" ? tokensLimit.percentage : null

      const windows: Record<string, UsageWindow> = {}
      if (tokensLimit) {
        windows[windowLabel] = toUsageWindow({ usedPercent, windowSeconds, resetAt })
      }

      return buildResult({
        providerId: "zai-coding-plan",
        providerName: "Z.AI Coding Plan",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "zai-coding-plan",
        providerName: "Z.AI Coding Plan",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const zhipuaiProvider: QuotaProviderModule = {
  providerId: "zhipuai-coding-plan",
  providerName: "ZhipuAI Coding Plan",
  aliases: ["zhipuai-coding-plan", "zhipuai"],
  isConfigured: (auth) => Boolean(auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth || auth.type !== "api") {
      return buildResult({
        providerId: "zhipuai-coding-plan",
        providerName: "ZhipuAI Coding Plan",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const apiKey = auth.key
    if (!apiKey) {
      return buildResult({
        providerId: "zhipuai-coding-plan",
        providerName: "ZhipuAI Coding Plan",
        ok: false,
        configured: false,
        error: "No API key",
      })
    }

    try {
      const response = await fetch("https://open.bigmodel.cn/api/monitor/usage/quota/limit", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "zhipuai-coding-plan",
          providerName: "ZhipuAI Coding Plan",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : []
      const windows: Record<string, UsageWindow> = {}

      for (const limit of limits) {
        if (!limit || typeof limit !== "object") continue
        const l = limit as Record<string, unknown>
        if (l?.type === "TOKENS_LIMIT") {
          const ws = toNumber(l.number)
          if (ws !== null) {
            windows["Tokens"] = toUsageWindow({
              usedPercent: toNumber(l.percentage),
              windowSeconds: ws * 3600,
              resetAt: toTimestamp(l.nextResetTime),
            })
          }
        } else if (l?.type === "TIME_LIMIT") {
          const ws = toNumber(l.number)
          if (ws !== null) {
            windows["MCP Tools"] = toUsageWindow({
              usedPercent: toNumber(l.percentage),
              windowSeconds: ws * 60,
              resetAt: toTimestamp(l.nextResetTime),
            })
          }
        }
      }

      return buildResult({
        providerId: "zhipuai-coding-plan",
        providerName: "ZhipuAI Coding Plan",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "zhipuai-coding-plan",
        providerName: "ZhipuAI Coding Plan",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const kimiProvider: QuotaProviderModule = {
  providerId: "kimi-for-coding",
  providerName: "Kimi Coding Plan",
  aliases: ["kimi-for-coding", "kimi"],
  isConfigured: (auth) => Boolean(auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth || auth.type !== "api") {
      return buildResult({
        providerId: "kimi-for-coding",
        providerName: "Kimi Coding Plan",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const apiKey = auth.key
    if (!apiKey) {
      return buildResult({
        providerId: "kimi-for-coding",
        providerName: "Kimi Coding Plan",
        ok: false,
        configured: false,
        error: "No API key",
      })
    }

    try {
      const response = await fetch("https://platform.moonshot.cn/api/v1/usage/quota", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "kimi-for-coding",
          providerName: "Kimi Coding Plan",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      if (payload?.data) {
        const used = toNumber(payload.data.used)
        const limit = toNumber(payload.data.limit)
        const usedPercent = used !== null && limit !== null && limit > 0 ? (used / limit) * 100 : null
        windows["quota"] = toUsageWindow({
          usedPercent,
          windowSeconds: null,
          resetAt: toTimestamp(payload.data.reset_at),
        })
      }

      return buildResult({
        providerId: "kimi-for-coding",
        providerName: "Kimi Coding Plan",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "kimi-for-coding",
        providerName: "Kimi Coding Plan",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const openrouterProvider: QuotaProviderModule = {
  providerId: "openrouter",
  providerName: "OpenRouter",
  aliases: ["openrouter"],
  isConfigured: (auth) => Boolean(auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth || auth.type !== "api") {
      return buildResult({
        providerId: "openrouter",
        providerName: "OpenRouter",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const apiKey = auth.key
    if (!apiKey) {
      return buildResult({
        providerId: "openrouter",
        providerName: "OpenRouter",
        ok: false,
        configured: false,
        error: "No API key",
      })
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/quota", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "openrouter",
          providerName: "OpenRouter",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      if (payload?.data) {
        const data = payload.data
        const used = toNumber(data.total_usage)
        const limit = toNumber(data.limit)
        const usedPercent = used !== null && limit !== null && limit > 0 ? (used / limit) * 100 : null
        windows["quota"] = toUsageWindow({ usedPercent, windowSeconds: null, resetAt: toTimestamp(data.reset_at) })
      }

      return buildResult({
        providerId: "openrouter",
        providerName: "OpenRouter",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "openrouter",
        providerName: "OpenRouter",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const nanogptProvider: QuotaProviderModule = {
  providerId: "nano-gpt",
  providerName: "NanoGPT",
  aliases: ["nano-gpt", "nanogpt", "nano_gpt"],
  isConfigured: (auth) => Boolean(auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth || auth.type !== "api") {
      return buildResult({
        providerId: "nano-gpt",
        providerName: "NanoGPT",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const apiKey = auth.key
    if (!apiKey) {
      return buildResult({
        providerId: "nano-gpt",
        providerName: "NanoGPT",
        ok: false,
        configured: false,
        error: "No API key",
      })
    }

    try {
      const response = await fetch("https://api.nanogpt.io/v1/quota", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "nano-gpt",
          providerName: "NanoGPT",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      if (payload?.data) {
        windows["quota"] = toUsageWindow({
          usedPercent: toNumber(payload.data.percentage),
          windowSeconds: null,
          resetAt: toTimestamp(payload.data.reset_at),
        })
      }

      return buildResult({
        providerId: "nano-gpt",
        providerName: "NanoGPT",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "nano-gpt",
        providerName: "NanoGPT",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const copilotProvider: QuotaProviderModule = {
  providerId: "github-copilot",
  providerName: "GitHub Copilot",
  aliases: ["github-copilot", "copilot"],
  isConfigured: (auth) => Boolean(auth?.type === "oauth" || auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth) {
      return buildResult({
        providerId: "github-copilot",
        providerName: "GitHub Copilot",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const accessToken = auth.type === "oauth" ? auth.access : auth.type === "api" ? auth.key : null
    if (!accessToken) {
      return buildResult({
        providerId: "github-copilot",
        providerName: "GitHub Copilot",
        ok: false,
        configured: false,
        error: "No access token",
      })
    }

    try {
      const response = await fetch("https://api.github.com/copilot/usage", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github.copilot-usage+json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "github-copilot",
          providerName: "GitHub Copilot",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      if (payload?.capabilities) {
        const caps = payload.capabilities
        const used =
          caps.used_seats && caps.total_seats && caps.total_seats > 0
            ? (caps.used_seats / caps.total_seats) * 100
            : null
        windows["seats"] = toUsageWindow({ usedPercent: used, windowSeconds: null, resetAt: null })
      }

      return buildResult({
        providerId: "github-copilot",
        providerName: "GitHub Copilot",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "github-copilot",
        providerName: "GitHub Copilot",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const minimaxProvider: QuotaProviderModule = {
  providerId: "minimax-coding-plan",
  providerName: "MiniMax Coding Plan",
  aliases: ["minimax-coding-plan", "minimax"],
  isConfigured: (auth) => Boolean(auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth || auth.type !== "api") {
      return buildResult({
        providerId: "minimax-coding-plan",
        providerName: "MiniMax Coding Plan",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const apiKey = auth.key
    if (!apiKey) {
      return buildResult({
        providerId: "minimax-coding-plan",
        providerName: "MiniMax Coding Plan",
        ok: false,
        configured: false,
        error: "No API key",
      })
    }

    try {
      const response = await fetch("https://platform.minimax.io/api/v1/usage/quota", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "minimax-coding-plan",
          providerName: "MiniMax Coding Plan",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      if (payload?.data) {
        windows["quota"] = toUsageWindow({
          usedPercent: toNumber(payload.data.usage_percentage),
          windowSeconds: null,
          resetAt: toTimestamp(payload.data.reset_at),
        })
      }

      return buildResult({
        providerId: "minimax-coding-plan",
        providerName: "MiniMax Coding Plan",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "minimax-coding-plan",
        providerName: "MiniMax Coding Plan",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

const ollamaCloudProvider: QuotaProviderModule = {
  providerId: "ollama-cloud",
  providerName: "Ollama Cloud",
  aliases: ["ollama-cloud"],
  isConfigured: (auth) => Boolean(auth?.type === "api"),
  fetchQuota: async (auth) => {
    if (!auth || auth.type !== "api") {
      return buildResult({
        providerId: "ollama-cloud",
        providerName: "Ollama Cloud",
        ok: false,
        configured: false,
        error: "Not configured",
      })
    }

    const apiKey = auth.key
    if (!apiKey) {
      return buildResult({
        providerId: "ollama-cloud",
        providerName: "Ollama Cloud",
        ok: false,
        configured: false,
        error: "No API key",
      })
    }

    try {
      const response = await fetch("https://cloud.ollama.ai/api/quota", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      })

      if (!response.ok) {
        return buildResult({
          providerId: "ollama-cloud",
          providerName: "Ollama Cloud",
          ok: false,
          configured: true,
          error: `API error: ${response.status}`,
        })
      }

      const payload = await response.json()
      const windows: Record<string, UsageWindow> = {}

      if (payload?.quota) {
        const quota = payload.quota
        const used = toNumber(quota.used)
        const limit = toNumber(quota.limit)
        const usedPercent = used !== null && limit !== null && limit > 0 ? (used / limit) * 100 : null
        windows["quota"] = toUsageWindow({ usedPercent, windowSeconds: null, resetAt: toTimestamp(quota.reset_at) })
      }

      return buildResult({
        providerId: "ollama-cloud",
        providerName: "Ollama Cloud",
        ok: true,
        configured: true,
        usage: { windows },
      })
    } catch (e) {
      return buildResult({
        providerId: "ollama-cloud",
        providerName: "Ollama Cloud",
        ok: false,
        configured: true,
        error: e instanceof Error ? e.message : "Request failed",
      })
    }
  },
}

// Registry
const PROVIDERS: Record<string, QuotaProviderModule> = {
  claude: claudeProvider,
  codex: codexProvider,
  google: googleProvider,
  "zai-coding-plan": zaiProvider,
  "zhipuai-coding-plan": zhipuaiProvider,
  "kimi-for-coding": kimiProvider,
  openrouter: openrouterProvider,
  "nano-gpt": nanogptProvider,
  "github-copilot": copilotProvider,
  "minimax-coding-plan": minimaxProvider,
  "ollama-cloud": ollamaCloudProvider,
}

function findAuthForAliases(authMap: Record<string, Auth.Info>, aliases: string[]): Auth.Info | undefined {
  for (const alias of aliases) {
    if (authMap[alias]) return authMap[alias]
  }
  return undefined
}

export const QuotaCommand = cmd({
  command: "quota [provider]",
  describe: "show quota usage for providers",
  builder: (yargs: Argv) => {
    return yargs.positional("provider", { describe: "provider ID to check quota for", type: "string" })
  },
  handler: async (args) => {
    const authMap = await Auth.all()

    if (args.provider) {
      const provider = PROVIDERS[args.provider]
      if (!provider) {
        UI.error(`Unknown provider: ${args.provider}`)
        UI.println(`Available providers: ${Object.keys(PROVIDERS).join(", ")}`)
        return
      }

      const auth = findAuthForAliases(authMap, provider.aliases)
      const isConfigured = await provider.isConfigured(auth)
      if (!auth || !isConfigured) {
        UI.error(`Provider ${args.provider} is not configured. Run 'opencode auth login ${args.provider}' first.`)
        return
      }

      UI.println(`Checking quota for ${provider.providerName}...`)
      const result = await provider.fetchQuota(auth)
      displayResult(result)
    } else {
      const configured: string[] = []
      for (const [id, provider] of Object.entries(PROVIDERS)) {
        const auth = findAuthForAliases(authMap, provider.aliases)
        const isConfigured = await provider.isConfigured(auth)
        if (isConfigured) configured.push(id)
      }

      if (configured.length === 0) {
        UI.println("No providers configured with quota support.")
        return
      }

      UI.println("Configured providers with quota support:")
      for (const id of configured) {
        const provider = PROVIDERS[id]
        const auth = findAuthForAliases(authMap, provider.aliases)
        try {
          const result = await provider.fetchQuota(auth!)
          displayResult(result)
        } catch (e) {
          UI.error(`Failed to fetch quota for ${id}: ${e instanceof Error ? e.message : "Unknown error"}`)
        }
      }
    }
  },
})

function displayResult(result: QuotaProviderResult) {
  if (!result.ok) {
    UI.error(`  ${result.providerName}: ${result.error}`)
    return
  }

  if (!result.usage?.windows || Object.keys(result.usage.windows).length === 0) {
    UI.println(`  ${result.providerName}: No quota information available`)
    return
  }

  for (const [windowName, window] of Object.entries(result.usage.windows)) {
    if (window.valueLabel) {
      UI.println(`  ${result.providerName}/${windowName}: ${window.valueLabel}`)
      continue
    }

    if (window.usedPercent !== null) {
      const percent = window.usedPercent.toFixed(1)
      const resetInfo = window.resetAtFormatted ? ` (resets ${window.resetAtFormatted})` : ""
      UI.println(`  ${result.providerName}/${windowName}: ${percent}% used${resetInfo}`)
    } else {
      UI.println(`  ${result.providerName}/${windowName}: available`)
    }
  }
}
