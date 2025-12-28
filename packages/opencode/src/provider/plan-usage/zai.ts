import { Log } from "@/util/log"
import { registerProvider, type PlanUsageHandler } from "../plan-usage"

const log = Log.create({ service: "zai-plan-usage" })

// z.ai specific types
interface ZaiPlanUsageLimit {
  type: string
  unit: number
  number: number
  usage: number
  currentValue: number
  remaining: number
  percentage: number
  nextResetTime?: number
}

interface ZaiPlanUsageResponse {
  data?: { limits?: ZaiPlanUsageLimit[] }
  limits?: ZaiPlanUsageLimit[]
}

function selectLimit(limits: ZaiPlanUsageLimit[]): ZaiPlanUsageLimit | null {
  return limits.find((l) => l.type === "TOKENS_LIMIT") ?? null
}

function fetchWithTimeout(url: string, headers: Record<string, string>, timeout: number): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  return fetch(url, {
    method: "GET",
    headers,
    signal: controller.signal,
  }).then((response) => {
    clearTimeout(id)
    return response
  })
}

async function parsePlanUsageResponse(
  response: Response,
): Promise<{ used: number; total: number; resetAt?: Date; percentage?: number } | { error: string }> {
  if (!response.ok) {
    const text = await response.text()
    return { error: `HTTP ${response.status}: ${text}` }
  }

  const json = (await response.json()) as unknown
  const limits = extractLimits(json)

  if (!limits || !Array.isArray(limits) || limits.length === 0) {
    return { error: "Invalid plan usage response format" }
  }

  const limit = selectLimit(limits)
  if (!limit) {
    return { error: "No token limit found in response" }
  }

  return {
    used: limit.usage,
    total: limit.number,
    resetAt: limit.nextResetTime ? new Date(limit.nextResetTime) : undefined,
    percentage: limit.percentage,
  }
}

function extractLimits(json: unknown): ZaiPlanUsageLimit[] | undefined {
  if (typeof json !== "object" || json === null) return undefined

  const candidate = json as Record<string, unknown>

  // Check for { data: { limits: [...] } }
  if ("data" in candidate && typeof candidate.data === "object" && candidate.data !== null) {
    const data = candidate.data as Record<string, unknown>
    if ("limits" in data && Array.isArray(data.limits)) {
      return data.limits as ZaiPlanUsageLimit[]
    }
  }

  // Check for { limits: [...] }
  if ("limits" in candidate && Array.isArray(candidate.limits)) {
    return candidate.limits as ZaiPlanUsageLimit[]
  }

  return undefined
}

const zaiPlanUsageHandler: PlanUsageHandler = async ({ token, baseURL, timeout }) => {
  if (!token) return { error: "No API key configured" }
  if (!baseURL) return { error: "No base URL configured" }

  const url = new URL(baseURL)
  const endpoint = `${url.origin}/api/monitor/usage/quota/limit`

  return fetchWithTimeout(
    endpoint,
    {
      Authorization: token,
      "Accept-Language": "en-US,en",
      "Content-Type": "application/json",
    },
    timeout,
  )
    .then(parsePlanUsageResponse)
    .then((result) => ("error" in result ? { error: result.error } : { planUsage: result }))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.debug("Failed to fetch plan usage", { provider: "zai-coding-plan", error: msg })
      return { error: msg }
    })
}

// Register on import
registerProvider("zai-coding-plan", zaiPlanUsageHandler)
