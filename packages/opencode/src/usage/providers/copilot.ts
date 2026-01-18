import type { Auth } from "@/auth"
import type { ProviderUsage, RateWindow } from "../types"
import { loadCopilotUsageToken } from "./copilot-auth"

const USAGE_URL = "https://api.github.com/copilot_internal/user"

interface CopilotUsageResponse {
  quota_snapshots: {
    premium_interactions?: CopilotQuotaSnapshot
    chat?: CopilotQuotaSnapshot
  }
  copilot_plan?: string
  quota_reset_date?: string
}

interface CopilotQuotaSnapshot {
  entitlement: number
  remaining: number
  percent_remaining: number
  quota_id: string
}

async function tryFetchWithToken(token: string): Promise<{ ok: true; data: CopilotUsageResponse } | { ok: false; status: number }> {
  const response = await fetch(USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "X-Github-Api-Version": "2025-04-01",
    },
  })

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return { ok: false, status: response.status }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Copilot usage request failed (${response.status}): ${body || response.statusText}`)
  }

  const data = (await response.json()) as CopilotUsageResponse
  return { ok: true, data }
}

export async function fetchCopilotUsage(auth: Auth.Info | null): Promise<ProviderUsage> {
  // Collect all token candidates
  const tokens: string[] = []

  // 1. Try the usage-specific token first (stored by our device flow)
  const usageToken = await loadCopilotUsageToken()
  if (usageToken?.accessToken) {
    tokens.push(usageToken.accessToken)
  }

  // 2. Try tokens from OpenCode's auth system
  if (auth?.type === "oauth") {
    if (auth.access && !tokens.includes(auth.access)) {
      tokens.push(auth.access)
    }
    if (auth.refresh && !tokens.includes(auth.refresh)) {
      tokens.push(auth.refresh)
    }
  }

  if (tokens.length === 0) {
    return {
      providerId: "github-copilot",
      providerLabel: "GitHub Copilot",
      status: "error",
      error: "copilot_reauth_required",
    }
  }

  // Try each token until one works
  for (const token of tokens) {
    const result = await tryFetchWithToken(token)
    if (result.ok) {
      const data = result.data
      const resetAt = data.quota_reset_date ? new Date(data.quota_reset_date).toISOString() : undefined
      return {
        providerId: "github-copilot",
        providerLabel: "GitHub Copilot",
        status: "ok",
        primary: toRateWindow(data.quota_snapshots?.premium_interactions, "Premium", resetAt),
        secondary: toRateWindow(data.quota_snapshots?.chat, "Chat", resetAt),
        plan: formatPlan(data.copilot_plan),
      }
    }
    // If this token failed with auth error, try next one
  }

  // All tokens failed
  return {
    providerId: "github-copilot",
    providerLabel: "GitHub Copilot",
    status: "error",
    error: "copilot_reauth_required",
  }
}

function toRateWindow(snapshot: CopilotQuotaSnapshot | undefined, label: string, resetAt?: string): RateWindow | undefined {
  if (!snapshot) return undefined
  return {
    label,
    usedPercent: Math.max(0, 100 - snapshot.percent_remaining),
    resetsAt: resetAt,
  }
}

function formatPlan(plan?: string): string | undefined {
  if (!plan) return undefined
  const trimmed = plan.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : undefined
}
