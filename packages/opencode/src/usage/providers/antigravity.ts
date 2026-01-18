import { Global } from "@/global"
import path from "path"
import type { ProviderUsage, RateWindow } from "../types"

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
const ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com"
const ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com"
const ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com"
const LOAD_ENDPOINTS = [ENDPOINT_PROD, ENDPOINT_DAILY, ENDPOINT_AUTOPUSH]
const FETCH_MODELS_URL = `${ENDPOINT_PROD}/v1internal:fetchAvailableModels`

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
const CLIENT_SECRET = "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"
const LOAD_USER_AGENT = "antigravity/windows/amd64"
const QUOTA_USER_AGENT = "antigravity/1.11.3 Darwin/arm64"
const CLIENT_METADATA = '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
const X_GOOG_API_CLIENT = "google-cloud-sdk vscode_cloudshelleditor/0.1"
const FALLBACK_PROJECT = "rising-fact-p41fc"

interface AntigravityAccount {
  email?: string
  refreshToken: string
  projectId?: string
  managedProjectId?: string
}

interface AccountsFile {
  version: number
  accounts: AntigravityAccount[]
  activeIndex?: number
}

interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string | { id?: string }
  currentTier?: { id?: string }
  paidTier?: { id?: string }
}

interface FetchModelsResponse {
  models?: Record<string, { quotaInfo?: { remainingFraction?: number; resetTime?: string } }>
}

interface ModelQuota {
  modelId: string
  percentRemaining: number // 0-100, where 0 = fully used, 100 = fresh
  resetTime?: string
}

export async function fetchAntigravityUsage(): Promise<ProviderUsage | null> {
  const accountsFile = await loadAccountsFile()
  if (!accountsFile?.accounts?.length) return null

  const account = accountsFile.accounts[Math.max(0, Math.min(accountsFile.activeIndex ?? 0, accountsFile.accounts.length - 1))]
  if (!account) return null

  try {
    const refreshParts = parseRefreshToken(account.refreshToken)
    const accessToken = await refreshAccessToken(refreshParts.refreshToken)
    const fallbackProjectId = account.managedProjectId ?? refreshParts.managedProjectId ?? account.projectId ?? refreshParts.projectId ?? FALLBACK_PROJECT
    const { projectId, subscriptionTier } = await loadCodeAssist(accessToken, fallbackProjectId)
    const quotaResponse = await fetchAvailableModels(accessToken, projectId ?? fallbackProjectId)

    const quotas = extractModelQuotas(quotaResponse.models ?? {})
    
    // Find Gemini and Claude quotas
    const geminiQuota = resolveModelQuota(quotas, "gemini")
    const claudeQuota = resolveModelQuota(quotas, "claude")

    return {
      providerId: "antigravity",
      providerLabel: "Antigravity",
      status: "ok",
      primary: geminiQuota ? toRateWindow(geminiQuota) : undefined,
      secondary: claudeQuota ? toRateWindow(claudeQuota) : undefined,
      accountEmail: account.email,
      plan: subscriptionTier,
    }
  } catch (error) {
    return {
      providerId: "antigravity",
      providerLabel: "Antigravity",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function loadAccountsFile(): Promise<AccountsFile | null> {
  const filePath = path.join(Global.Path.config, "antigravity-accounts.json")
  const file = Bun.file(filePath)
  if (!(await file.exists())) return null
  return file.json().catch(() => null)
}

function parseRefreshToken(raw: string): { refreshToken: string; projectId?: string; managedProjectId?: string } {
  const [refreshToken = "", projectId, managedProjectId] = (raw ?? "").split("|")
  return { refreshToken, projectId: projectId || undefined, managedProjectId: managedProjectId || undefined }
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  if (!refreshToken) throw new Error("Antigravity refresh token missing")
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  })
  if (!response.ok) throw new Error(`Token refresh failed (${response.status})`)
  const payload = (await response.json()) as { access_token?: string }
  if (!payload.access_token) throw new Error("No access token returned")
  return payload.access_token
}

async function loadCodeAssist(accessToken: string, projectId: string): Promise<{ projectId?: string; subscriptionTier?: string }> {
  const metadata = { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI", duetProject: projectId }
  for (const endpoint of LOAD_ENDPOINTS) {
    const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "User-Agent": LOAD_USER_AGENT, "X-Goog-Api-Client": X_GOOG_API_CLIENT, "Client-Metadata": CLIENT_METADATA },
      body: JSON.stringify({ metadata }),
    })
    if (!response.ok) continue
    const data = (await response.json()) as LoadCodeAssistResponse
    const proj = typeof data.cloudaicompanionProject === "string" ? data.cloudaicompanionProject : data.cloudaicompanionProject?.id
    return { projectId: proj, subscriptionTier: data.paidTier?.id ?? data.currentTier?.id }
  }
  return {}
}

async function fetchAvailableModels(accessToken: string, projectId: string): Promise<FetchModelsResponse> {
  const response = await fetch(FETCH_MODELS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "User-Agent": QUOTA_USER_AGENT, "X-Goog-Api-Client": X_GOOG_API_CLIENT, "Client-Metadata": CLIENT_METADATA },
    body: JSON.stringify({ project: projectId }),
  })
  if (!response.ok) throw new Error(`Quota request failed (${response.status})`)
  return (await response.json()) as FetchModelsResponse
}

function extractModelQuotas(models: Record<string, { quotaInfo?: { remainingFraction?: number; resetTime?: string } }>): ModelQuota[] {
  const quotas: ModelQuota[] = []
  for (const [name, info] of Object.entries(models)) {
    // Only include models with quotaInfo (gemini or claude)
    if (!info.quotaInfo) continue
    if (!name.includes("gemini") && !name.includes("claude")) continue
    
    const fraction = info.quotaInfo.remainingFraction
    // If remainingFraction is null/undefined, it means 0% remaining (fully used)
    // This matches Antigravity-Manager behavior: .unwrap_or(0)
    const percentRemaining = typeof fraction === "number" && !Number.isNaN(fraction) ? fraction * 100 : 0
    
    quotas.push({
      modelId: name,
      percentRemaining,
      resetTime: info.quotaInfo.resetTime,
    })
  }
  return quotas
}

function resolveModelQuota(quotas: ModelQuota[], type: "gemini" | "claude"): { label: string; quota: ModelQuota } | null {
  const matches = quotas.filter((q) => q.modelId.includes(type))
  if (!matches.length) return null

  let quota: ModelQuota

  if (type === "gemini") {
    const preferred = matches.find((q) => q.modelId.includes("gemini-3-pro"))
    quota = preferred ?? matches.reduce((a, b) => (b.percentRemaining < a.percentRemaining ? b : a))
  } else {
    // Pick the model with lowest remaining (highest usage) - most relevant limit
    quota = matches.reduce((a, b) => (b.percentRemaining < a.percentRemaining ? b : a))
  }

  // Generate friendly label
  const label = formatModelLabel(quota.modelId)

  return { label, quota }
}

function formatModelLabel(modelId: string): string {
  // Map model IDs to friendly names
  const id = modelId.toLowerCase()
  
  if (id.includes("claude-opus-4-5") || id.includes("claude-opus-4.5")) return "Claude Opus 4.5"
  if (id.includes("claude-opus-4")) return "Claude Opus 4"
  if (id.includes("claude-sonnet-4-5") || id.includes("claude-sonnet-4.5")) return "Claude Sonnet 4.5"
  if (id.includes("claude-sonnet-4")) return "Claude Sonnet 4"
  if (id.includes("claude-opus")) return "Claude Opus"
  if (id.includes("claude-sonnet")) return "Claude Sonnet"
  if (id.includes("claude")) return "Claude"
  
  if (id.includes("gemini-3-pro")) return "Gemini 3 Pro"
  if (id.includes("gemini-3-flash")) return "Gemini 3 Flash"
  if (id.includes("gemini-2.5-pro")) return "Gemini 2.5 Pro"
  if (id.includes("gemini-2.5-flash")) return "Gemini 2.5 Flash"
  if (id.includes("gemini")) return "Gemini"
  
  return modelId
}

function toRateWindow(match: { label: string; quota: ModelQuota }): RateWindow {
  const { label, quota } = match
  const usedPercent = Math.max(0, 100 - quota.percentRemaining)
  
  // Build label with window info
  const windowLabel = buildWindowLabel(label, quota.resetTime)
  
  return {
    label: windowLabel,
    usedPercent,
    resetsAt: quota.resetTime ? new Date(quota.resetTime).toISOString() : undefined,
  }
}

function buildWindowLabel(modelLabel: string, resetsAt?: string): string {
  if (!resetsAt) return modelLabel
  const resetDate = new Date(resetsAt)
  if (Number.isNaN(resetDate.getTime())) return modelLabel
  const diffHours = (resetDate.getTime() - Date.now()) / (1000 * 60 * 60)
  if (diffHours <= 0) return modelLabel
  const windowType = diffHours <= 6 ? "5h window" : diffHours <= 26 ? "daily" : diffHours <= 180 ? "weekly" : `${Math.ceil(diffHours / 24)}d window`
  return `${modelLabel} (${windowType})`
}
