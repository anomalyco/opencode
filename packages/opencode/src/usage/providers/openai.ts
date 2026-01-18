import type { Auth } from "@/auth"
import type { ProviderUsage, RateWindow } from "../types"

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

interface CodexUsageResponse {
  plan_type?: string
  rate_limit?: {
    primary_window?: WindowSnapshot
    secondary_window?: WindowSnapshot
  }
}

interface WindowSnapshot {
  used_percent: number
  reset_at: number
  limit_window_seconds: number
}

export async function fetchOpenAIUsage(auth: Auth.Info): Promise<ProviderUsage> {
  if (auth.type !== "oauth") {
    return { providerId: "openai", providerLabel: "OpenAI/Codex", status: "unsupported", error: "Requires OAuth" }
  }

  const response = await fetch(USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.access}`,
      Accept: "application/json",
      "User-Agent": "opencode",
      ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
    },
  })

  if (response.status === 401 || response.status === 403) {
    return {
      providerId: "openai",
      providerLabel: "OpenAI/Codex",
      status: "error",
      error: "Token expired or invalid. Run /connect to refresh.",
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`OpenAI usage request failed (${response.status}): ${body || response.statusText}`)
  }

  const data = (await response.json()) as CodexUsageResponse
  return {
    providerId: "openai",
    providerLabel: "OpenAI/Codex",
    status: "ok",
    primary: toRateWindow(data.rate_limit?.primary_window, "Current session"),
    secondary: toRateWindow(data.rate_limit?.secondary_window, "Current week"),
    plan: data.plan_type,
  }
}

function toRateWindow(snapshot: WindowSnapshot | undefined, label: string): RateWindow | undefined {
  if (!snapshot) return undefined
  return {
    label,
    usedPercent: snapshot.used_percent ?? 0,
    windowMinutes: snapshot.limit_window_seconds ? snapshot.limit_window_seconds / 60 : undefined,
    resetsAt: Number.isFinite(snapshot.reset_at) ? new Date(snapshot.reset_at * 1000).toISOString() : undefined,
  }
}
