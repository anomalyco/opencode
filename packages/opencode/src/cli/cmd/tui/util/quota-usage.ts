import type { OpencodeClient } from "@opencode-ai/sdk/v2"

export const QUOTA_PROVIDER_ORDER = ["codex", "nano-gpt", "antigravity", "gemini-cli", "qwen-cli", "claude"] as const

export type QuotaProviderID = (typeof QUOTA_PROVIDER_ORDER)[number]

export type QuotaStatus = "success" | "not_configured" | "not_authenticated" | "error"

export type QuotaMode = "count_and_percent" | "percent_only"

export type QuotaGroup = {
  name: string
  display: string
  used: number
  max: number
  remaining: number
  resetTime?: string
}

export type QuotaProvider = {
  status: QuotaStatus
  message?: string
  mode: QuotaMode
  groups: QuotaGroup[]
}

export type QuotaUsage = Record<QuotaProviderID, QuotaProvider>

type RawQuotaGroup = {
  name: string
  display: string
  used: number
  max: number
  remaining: number
  reset_time_iso?: string | null
}

type RawProvider = {
  status: QuotaStatus
  message?: string
  ui: {
    mode: QuotaMode
  }
  groups?: RawQuotaGroup[]
}

type RawUsage = {
  providers: {
    antigravity: RawProvider
    "gemini-cli": RawProvider
    "qwen-cli": RawProvider
    claude: RawProvider
    "nano-gpt": RawProvider
    codex: RawProvider
  }
}

function emptyProvider(mode: QuotaMode): QuotaProvider {
  return {
    status: "not_configured",
    mode,
    groups: [],
  }
}

function fallbackUsage(): QuotaUsage {
  return {
    antigravity: emptyProvider("count_and_percent"),
    "gemini-cli": emptyProvider("count_and_percent"),
    "qwen-cli": emptyProvider("count_and_percent"),
    claude: emptyProvider("percent_only"),
    "nano-gpt": emptyProvider("count_and_percent"),
    codex: emptyProvider("percent_only"),
  }
}

export function formatResetTime(resetIso: string | null | undefined): string {
  if (!resetIso) return ""
  const resetDate = new Date(resetIso)
  const diffMs = resetDate.getTime() - Date.now()
  if (diffMs <= 0) return "now"
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m`
  const hours = Math.floor(diffMins / 60)
  const mins = diffMins % 60
  if (hours < 24) return `${hours}h ${mins}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

function normalizeProvider(provider: RawProvider): QuotaProvider {
  return {
    status: provider.status,
    message: provider.message,
    mode: provider.ui.mode,
    groups: (provider.groups ?? []).map((group) => ({
      name: group.name,
      display: group.display,
      used: group.used,
      max: group.max,
      remaining: group.remaining,
      resetTime: group.reset_time_iso ? formatResetTime(group.reset_time_iso) : undefined,
    })),
  }
}

export async function fetchUsage(client: OpencodeClient): Promise<QuotaUsage> {
  const result = await client.provider.usage.list()
  if (result.error || !result.data) {
    const usage = fallbackUsage()
    const message = result.error instanceof Error ? result.error.message : result.error ? String(result.error) : ""
    return {
      antigravity: {
        ...usage.antigravity,
        status: "error",
        message,
      },
      "gemini-cli": {
        ...usage["gemini-cli"],
        status: "error",
        message,
      },
      "qwen-cli": {
        ...usage["qwen-cli"],
        status: "error",
        message,
      },
      claude: {
        ...usage.claude,
        status: "error",
        message,
      },
      "nano-gpt": {
        ...usage["nano-gpt"],
        status: "error",
        message,
      },
      codex: {
        ...usage.codex,
        status: "error",
        message,
      },
    }
  }

  const data = result.data as RawUsage
  return {
    antigravity: normalizeProvider(data.providers.antigravity),
    "gemini-cli": normalizeProvider(data.providers["gemini-cli"]),
    "qwen-cli": normalizeProvider(data.providers["qwen-cli"]),
    claude: normalizeProvider(data.providers.claude),
    "nano-gpt": normalizeProvider(data.providers["nano-gpt"]),
    codex: normalizeProvider(data.providers.codex),
  }
}
