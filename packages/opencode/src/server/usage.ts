import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Auth } from "@/auth"
import { Config } from "../config/config"
import { Env } from "../env"

const QuotaGroup = z.object({
  name: z.string(),
  display: z.string(),
  used: z.number(),
  max: z.number(),
  remaining: z.number(),
  reset_time_iso: z.string().optional().nullable(),
})

const UsageStatus = z.enum(["success", "not_configured", "not_authenticated", "error"])

const UsageMode = z.enum(["count_and_percent", "percent_only"])

const ProviderUsageResponse = z.object({
  status: UsageStatus,
  message: z.string().optional(),
  ui: z.object({
    mode: UsageMode,
  }),
  groups: z.array(QuotaGroup).optional(),
})

const UsageResponse = z.object({
  providers: z.object({
    antigravity: ProviderUsageResponse,
    "gemini-cli": ProviderUsageResponse,
    "qwen-cli": ProviderUsageResponse,
    claude: ProviderUsageResponse,
    "nano-gpt": ProviderUsageResponse,
    codex: ProviderUsageResponse,
  }),
})

type QuotaGroupInfo = z.infer<typeof QuotaGroup>
type ProviderUsageInfo = z.infer<typeof ProviderUsageResponse>
type UsageModeInfo = z.infer<typeof UsageMode>

type ProxyUsagePayload = {
  providers?: Record<
    string,
    {
      credential_count?: number
      quota_groups?: Record<
        string,
        {
          windows?: Record<
            string,
            {
              total_used?: number
              total_remaining?: number
              total_max?: number
              remaining_pct?: number | null
              reset_at?: number | null
            }
          >
        }
      >
      credentials?: Record<
        string,
        {
          model_usage?: Record<
            string,
            {
              windows?: Record<
                string,
                {
                  request_count?: number
                  total_used?: number
                  remaining?: number
                  total_remaining?: number
                  limit?: number | null
                  total_max?: number | null
                  remaining_pct?: number | null
                  reset_at?: number | null
                }
              >
            }
          >
        }
      >
    }
  >
}

function resetFromSeconds(input: unknown) {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return null
  return new Date(input * 1000).toISOString()
}

function proxyWindow(
  windows?: Record<
    string,
    {
      total_used?: number
      total_remaining?: number
      total_max?: number
      remaining_pct?: number | null
      reset_at?: number | null
    }
  >,
) {
  if (!windows) return
  const byMax = Object.values(windows).sort((a, b) => number(b.total_max) - number(a.total_max))
  return byMax[0]
}

type ClaudeUsagePayload = {
  five_hour?: {
    utilization?: number
    resets_at?: string | null
  } | null
  seven_day?: {
    utilization?: number
    resets_at?: string | null
  } | null
}

type NanoGptWindow = {
  used?: number
  remaining?: number
  percentUsed?: number
  resetAt?: number
}

type NanoGptUsagePayload = {
  limits?: {
    daily?: number
    monthly?: number
  }
  daily?: NanoGptWindow
  monthly?: NanoGptWindow
}

type CodexUsageWindow = {
  used_percent?: number
  limit_window_seconds?: number
  reset_at?: number | null
}

type CodexUsagePayload = {
  rate_limit?: {
    allowed?: boolean
    limit_reached?: boolean
    primary_window?: CodexUsageWindow | null
    secondary_window?: CodexUsageWindow | null
  }
}

const ANTIGRAVITY_GROUP_NAMES: Record<string, string> = {
  claude: "vertex",
  "g3-flash": "flash",
  "g3-pro": "pro",
}

const ANTIGRAVITY_GROUPS = ["claude", "g3-flash", "g3-pro"]

const GEMINI_CLI_GROUP_NAMES: Record<string, string> = {
  pro: "pro",
  "3-flash": "flash",
}

const GEMINI_CLI_GROUPS = ["pro", "3-flash"]

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

const PROXY_MODE: UsageModeInfo = "count_and_percent"
const CLAUDE_MODE: UsageModeInfo = "percent_only"
const CODEX_MODE: UsageModeInfo = "percent_only"
const QWEN_MAX_PER_CREDENTIAL = 2000

function number(input: unknown, fallback = 0) {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback
}

function text(input: unknown) {
  return typeof input === "string" && input.length > 0 ? input : undefined
}

function clamp(input: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, input))
}

function result(status: ProviderUsageInfo["status"], mode: UsageModeInfo, message?: string): ProviderUsageInfo {
  if (!message) {
    return {
      status,
      ui: { mode },
    }
  }
  return {
    status,
    message,
    ui: { mode },
  }
}

async function readError(response: Response) {
  const payload = await response.text().catch(() => "")
  return payload || `HTTP ${response.status}`
}

function percentRemaining(used: number, max: number, ratio?: number, remaining?: number) {
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    return clamp(Math.round((1 - ratio) * 100))
  }
  if (max <= 0) return 0
  const rest = typeof remaining === "number" && Number.isFinite(remaining) ? remaining : max - used
  return clamp(Math.round((rest / max) * 100))
}

function resetFromEpoch(input: unknown) {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return null
  return new Date(input).toISOString()
}

function proxyQuotaURL(baseURL: string, provider: string) {
  if (!URL.canParse(baseURL)) return undefined
  const root = new URL(baseURL)
  const path = root.pathname.replace(/\/$/, "")
  root.pathname = path.endsWith("/v1") ? `${path}/quota-stats` : "/v1/quota-stats"
  root.search = `provider=${provider}`
  return root.toString()
}

async function refreshToken(refresh: string) {
  const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: ANTHROPIC_CLIENT_ID,
    }),
  })

  if (!response.ok) {
    return { success: false as const }
  }

  const json = await response.json()

  return { success: true as const, access: json.access_token as string }
}

async function proxyUsage(
  config: Awaited<ReturnType<typeof Config.get>>,
  providerID: "antigravity" | "gemini-cli",
  quotaProvider: "antigravity" | "gemini_cli",
  sourceID: "antigravity" | "gemini_cli",
  names: string[],
  labels: Record<string, string>,
): Promise<ProviderUsageInfo> {
  const provider = config.provider?.[providerID]
  const baseURL = text(provider?.options?.baseURL)
  const apiKey = text(provider?.options?.apiKey)

  if (!baseURL || !apiKey) {
    return result("not_configured", PROXY_MODE)
  }

  const url = proxyQuotaURL(baseURL, quotaProvider)
  if (!url) {
    return result("error", PROXY_MODE, "Invalid proxy baseURL")
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "force_refresh",
      scope: "provider",
      provider: quotaProvider,
    }),
  }).catch((error) => error)

  if (response instanceof Error) {
    return result("error", PROXY_MODE, response.message)
  }

  if (!response.ok) {
    return result("error", PROXY_MODE, await readError(response))
  }

  const payload = (await response.json().catch(() => null)) as ProxyUsagePayload | null
  const item = payload?.providers?.[sourceID]
  const quotaGroups = item?.quota_groups ?? {}
  const groups = names.flatMap((name): QuotaGroupInfo[] => {
    const quota = quotaGroups[name]
    if (!quota?.windows) return []
    const window = proxyWindow(quota.windows)
    if (!window) return []
    const used = number(window.total_used)
    const max = number(window.total_max)
    const remaining =
      typeof window.remaining_pct === "number" && Number.isFinite(window.remaining_pct)
        ? clamp(Math.round(window.remaining_pct))
        : percentRemaining(used, max, undefined, number(window.total_remaining))
    return [
      {
        name,
        display: labels[name] ?? name,
        used,
        max,
        remaining,
        reset_time_iso: resetFromSeconds(window.reset_at),
      },
    ]
  })

  return {
    status: "success",
    ui: { mode: PROXY_MODE },
    groups,
  }
}

async function qwenUsage(config: Awaited<ReturnType<typeof Config.get>>): Promise<ProviderUsageInfo> {
  const provider = config.provider?.["qwen-cli"]
  const baseURL = text(provider?.options?.baseURL)
  const apiKey = text(provider?.options?.apiKey)

  if (!baseURL || !apiKey) {
    return result("not_configured", PROXY_MODE)
  }

  const quotaProvider = "qwen_code"
  const url = proxyQuotaURL(baseURL, quotaProvider)
  if (!url) {
    return result("error", PROXY_MODE, "Invalid proxy baseURL")
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "force_refresh",
      scope: "provider",
      provider: quotaProvider,
    }),
  }).catch((error) => error)

  if (response instanceof Error) {
    return result("error", PROXY_MODE, response.message)
  }

  if (!response.ok) {
    return result("error", PROXY_MODE, await readError(response))
  }

  const payload = (await response.json().catch(() => null)) as ProxyUsagePayload | null
  const item = payload?.providers?.[quotaProvider]

  const quotaGroups = item?.quota_groups ?? {}
  const direct = Object.keys(quotaGroups).flatMap((name): QuotaGroupInfo[] => {
    const quota = quotaGroups[name]
    if (!quota?.windows) return []
    const window = proxyWindow(quota.windows)
    if (!window) return []
    const used = number(window.total_used)
    const max = number(window.total_max)
    if (max <= 0) return []
    const remaining =
      typeof window.remaining_pct === "number" && Number.isFinite(window.remaining_pct)
        ? clamp(Math.round(window.remaining_pct))
        : percentRemaining(used, max, undefined, number(window.total_remaining))
    return [
      {
        name,
        display: name,
        used,
        max,
        remaining,
        reset_time_iso: resetFromSeconds(window.reset_at),
      },
    ]
  })

  if (direct.length > 0) {
    return {
      status: "success",
      ui: { mode: PROXY_MODE },
      groups: direct,
    }
  }

  const credentials = Object.values(item?.credentials ?? {})
  const credentialCount = Math.max(number(item?.credential_count, credentials.length), 1)
  const fallback = new Map<string, { used: number; max: number; reset_at: number | null }>()

  for (const credential of credentials) {
    for (const [modelID, model] of Object.entries(credential.model_usage ?? {})) {
      const windows = model.windows
      if (!windows) continue
      const byMax = Object.values(windows).sort((a, b) => {
        const aMax = number(a.total_max, number(a.limit))
        const bMax = number(b.total_max, number(b.limit))
        return bMax - aMax
      })
      const window = byMax[0]
      if (!window) continue

      const used = number(window.total_used, number(window.request_count))
      const max = Math.max(number(window.total_max, number(window.limit)), QWEN_MAX_PER_CREDENTIAL)
      const name = modelID.includes("/") ? (modelID.split("/").at(-1) ?? modelID) : modelID

      const existing = fallback.get(name)
      if (!existing) {
        fallback.set(name, {
          used,
          max,
          reset_at: typeof window.reset_at === "number" && Number.isFinite(window.reset_at) ? window.reset_at : null,
        })
        continue
      }

      fallback.set(name, {
        used: existing.used + used,
        max: existing.max + max,
        reset_at:
          typeof window.reset_at === "number" && Number.isFinite(window.reset_at)
            ? typeof existing.reset_at === "number"
              ? Math.min(existing.reset_at, window.reset_at)
              : window.reset_at
            : existing.reset_at,
      })
    }
  }

  const groups = Array.from(fallback.entries()).map(([name, value]) => {
    const max = Math.max(value.max, credentialCount * QWEN_MAX_PER_CREDENTIAL)
    return {
      name,
      display: name,
      used: value.used,
      max,
      remaining: percentRemaining(value.used, max),
      reset_time_iso: resetFromSeconds(value.reset_at),
    }
  })

  return {
    status: "success",
    ui: { mode: PROXY_MODE },
    groups,
  }
}

async function claudeUsage(auth: Awaited<ReturnType<typeof Auth.get>>): Promise<ProviderUsageInfo> {
  if (!auth || auth.type !== "oauth") {
    return result("not_authenticated", CLAUDE_MODE)
  }

  const access =
    auth.expires < Date.now()
      ? await refreshToken(auth.refresh).then((token) => {
          if (!token.success) return ""
          return token.access
        })
      : auth.access

  if (!access) {
    return result("error", CLAUDE_MODE, "Token refresh failed")
  }

  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${access}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  }).catch((error) => error)

  if (response instanceof Error) {
    return result("error", CLAUDE_MODE, response.message)
  }

  if (!response.ok) {
    return result("error", CLAUDE_MODE, await readError(response))
  }

  const payload = (await response.json().catch(() => null)) as ClaudeUsagePayload | null
  if (!payload) {
    return result("error", CLAUDE_MODE, "Invalid Claude usage response")
  }

  const groups = [
    {
      name: "five_hour",
      display: "session",
      usage: payload.five_hour,
    },
    {
      name: "seven_day",
      display: "weekly",
      usage: payload.seven_day,
    },
  ].flatMap((item): QuotaGroupInfo[] => {
    if (!item.usage) return []
    const used = clamp(Math.round(number(item.usage.utilization)))
    return [
      {
        name: item.name,
        display: item.display,
        used,
        max: 100,
        remaining: clamp(100 - used),
        reset_time_iso: text(item.usage.resets_at) ?? null,
      },
    ]
  })

  return {
    status: "success",
    ui: { mode: CLAUDE_MODE },
    groups,
  }
}

async function nanoGptUsage(
  config: Awaited<ReturnType<typeof Config.get>>,
  auth: Awaited<ReturnType<typeof Auth.get>>,
): Promise<ProviderUsageInfo> {
  const provider = config.provider?.["nano-gpt"]
  const authKey = auth && (auth.type === "api" || auth.type === "wellknown") ? auth.key : undefined
  const apiKey = Env.get("NANO_GPT_API_KEY") ?? authKey ?? text(provider?.options?.apiKey)

  if (!apiKey) {
    return result("not_configured", PROXY_MODE)
  }

  const baseURL = text(provider?.options?.baseURL) ?? "https://nano-gpt.com/api/v1"
  if (!URL.canParse(baseURL)) {
    return result("error", PROXY_MODE, "Invalid NanoGPT baseURL")
  }

  const url = `${new URL(baseURL).origin}/api/subscription/v1/usage`
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }).catch((error) => error)

  if (response instanceof Error) {
    return result("error", PROXY_MODE, response.message)
  }

  if (!response.ok) {
    return result("error", PROXY_MODE, await readError(response))
  }

  const payload = (await response.json().catch(() => null)) as NanoGptUsagePayload | null
  if (!payload?.limits || !payload.daily || !payload.monthly) {
    return result("error", PROXY_MODE, "Invalid NanoGPT usage response")
  }

  const groups = [
    {
      name: "daily",
      display: "daily",
      max: number(payload.limits.daily),
      usage: payload.daily,
    },
    {
      name: "monthly",
      display: "monthly",
      max: number(payload.limits.monthly),
      usage: payload.monthly,
    },
  ].flatMap((item): QuotaGroupInfo[] => {
    if (item.max <= 0) return []
    const used = number(item.usage.used)
    return [
      {
        name: item.name,
        display: item.display,
        used,
        max: item.max,
        remaining: percentRemaining(used, item.max, item.usage.percentUsed, item.usage.remaining),
        reset_time_iso: resetFromEpoch(item.usage.resetAt),
      },
    ]
  })

  return {
    status: "success",
    ui: { mode: PROXY_MODE },
    groups,
  }
}

function codexGroup(name: "primary_window" | "secondary_window", window?: CodexUsageWindow | null): QuotaGroupInfo[] {
  if (!window) return []
  const used = clamp(Math.round(number(window.used_percent)))
  return [
    {
      name,
      display: name === "primary_window" ? "session" : "weekly",
      used,
      max: 100,
      remaining: clamp(100 - used),
      reset_time_iso: resetFromSeconds(window.reset_at),
    },
  ]
}

async function codexUsage(auth: Awaited<ReturnType<typeof Auth.get>>): Promise<ProviderUsageInfo> {
  if (!auth || auth.type !== "oauth") {
    return result("not_authenticated", CODEX_MODE)
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.access}`,
    "Content-Type": "application/json",
    originator: "opencode",
  }
  if (auth.accountId) {
    headers["ChatGPT-Account-Id"] = auth.accountId
  }

  const response = await fetch("https://chatgpt.com/backend-api/codex/usage", {
    method: "GET",
    headers,
  }).catch((error) => error)

  if (response instanceof Error) {
    return result("error", CODEX_MODE, response.message)
  }

  if (response.status === 401 || response.status === 403) {
    return result("not_authenticated", CODEX_MODE)
  }

  if (!response.ok) {
    return result("error", CODEX_MODE, await readError(response))
  }

  const payload = (await response.json().catch(() => null)) as CodexUsagePayload | null
  if (!payload?.rate_limit) {
    return result("error", CODEX_MODE, "Invalid Codex usage response")
  }

  return {
    status: "success",
    ui: { mode: CODEX_MODE },
    groups: [
      ...codexGroup("primary_window", payload.rate_limit.primary_window),
      ...codexGroup("secondary_window", payload.rate_limit.secondary_window),
    ],
  }
}

export const UsageRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "Get usage",
    description: "Get quota usage for all supported providers.",
    operationId: "provider.usage.list",
    responses: {
      200: {
        description: "Provider quota usage",
        content: {
          "application/json": {
            schema: resolver(UsageResponse),
          },
        },
      },
    },
  }),
  async (c) => {
    const [config, anthropic, nanoGptAuth, openai] = await Promise.all([
      Config.get(),
      Auth.get("anthropic"),
      Auth.get("nano-gpt"),
      Auth.get("openai"),
    ])
    const [antigravity, geminiCli, qwenCli, claude, nanoGpt, codex] = await Promise.all([
      proxyUsage(config, "antigravity", "antigravity", "antigravity", ANTIGRAVITY_GROUPS, ANTIGRAVITY_GROUP_NAMES),
      proxyUsage(config, "gemini-cli", "gemini_cli", "gemini_cli", GEMINI_CLI_GROUPS, GEMINI_CLI_GROUP_NAMES),
      qwenUsage(config),
      claudeUsage(anthropic),
      nanoGptUsage(config, nanoGptAuth),
      codexUsage(openai),
    ])

    return c.json({
      providers: {
        antigravity,
        "gemini-cli": geminiCli,
        "qwen-cli": qwenCli,
        claude,
        "nano-gpt": nanoGpt,
        codex,
      },
    })
  },
)
