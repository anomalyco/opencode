import type { Auth } from "@/auth"
import type { ProviderUsage, RateWindow } from "../types"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const BETA_HEADER = "oauth-2025-04-20"

interface OAuthUsageResponse {
  five_hour?: OAuthUsageWindow
  seven_day?: OAuthUsageWindow
  seven_day_oauth_apps?: OAuthUsageWindow
  seven_day_opus?: OAuthUsageWindow
  seven_day_sonnet?: OAuthUsageWindow
}

interface OAuthUsageWindow {
  utilization?: number
  resets_at?: string
}

export async function fetchAnthropicUsage(auth: Auth.Info): Promise<ProviderUsage> {
  if (auth.type !== "oauth") {
    return { providerId: "anthropic", providerLabel: "Anthropic/Claude", status: "unsupported", error: "Requires OAuth" }
  }

  if (typeof auth.expires === "number" && auth.expires > 0 && Date.now() >= auth.expires) {
    return { providerId: "anthropic", providerLabel: "Anthropic/Claude", status: "error", error: "Token expired. Run /connect to refresh." }
  }

  const response = await fetch(USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.access}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": BETA_HEADER,
      "User-Agent": "opencode",
    },
  })

  if (response.status === 401 || response.status === 403) {
    return {
      providerId: "anthropic",
      providerLabel: "Anthropic/Claude",
      status: "error",
      error: "Token expired or invalid. Run /connect to refresh.",
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Anthropic usage request failed (${response.status}): ${body || response.statusText}`)
  }

  const data = (await response.json()) as OAuthUsageResponse

  // Determine tertiary label based on which model limit is present
  let tertiaryWindow: OAuthUsageWindow | undefined
  let tertiaryLabel = "Weekly (model)"
  if (data.seven_day_opus) {
    tertiaryWindow = data.seven_day_opus
    tertiaryLabel = "Weekly (Opus)"
  } else if (data.seven_day_sonnet) {
    tertiaryWindow = data.seven_day_sonnet
    tertiaryLabel = "Weekly (Sonnet)"
  }

  return {
    providerId: "anthropic",
    providerLabel: "Anthropic/Claude",
    status: "ok",
    primary: toRateWindow(data.five_hour, "5-hour window"),
    secondary: toRateWindow(data.seven_day ?? data.seven_day_oauth_apps, "7-day window"),
    tertiary: toRateWindow(tertiaryWindow, tertiaryLabel),
  }
}

function toRateWindow(window: OAuthUsageWindow | undefined, label: string): RateWindow | undefined {
  if (!window) return undefined
  const utilization = typeof window.utilization === "number" ? window.utilization : 0
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, utilization * 100)),
    resetsAt: window.resets_at || undefined,
  }
}
