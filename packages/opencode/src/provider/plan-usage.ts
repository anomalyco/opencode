import { Log } from "@/util/log"

const log = Log.create({ service: "plan-usage" })

/**
 * Generic plan usage interface that all providers should implement.
 * Each provider converts their specific format to this common representation.
 */
export interface PlanUsage {
  used: number
  total: number
  resetAt?: Date
  percentage?: number // Provider-supplied percentage if more accurate than derived
}

export function getPercentage(planUsage: PlanUsage): number {
  if (planUsage.percentage !== undefined) return planUsage.percentage
  return planUsage.total > 0 ? Math.round((planUsage.used / planUsage.total) * 100) : 0
}

export interface PlanUsageData {
  planUsage?: PlanUsage
  error?: string
}

export type PlanUsageHandler = (config: { token: string; baseURL: string; timeout: number }) => Promise<PlanUsageData>

const HANDLERS: Record<string, PlanUsageHandler> = {}

export function registerProvider(id: string, handler: PlanUsageHandler) {
  HANDLERS[id] = handler
}

// Load built-in providers
import("./plan-usage/zai")

type CacheEntry = { data: PlanUsageData; time: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 1000

export async function fetchPlanUsage(
  providerID: string,
  providers: Array<Record<string, unknown>>,
  timeout = 5000,
): Promise<PlanUsageData> {
  const config = await getProviderConfig(providerID, providers)
  if (!config.token) {
    log.debug("No API key configured for provider", { providerID })
    return { error: `No API key configured for provider: ${providerID}` }
  }
  if (!config.baseURL) {
    log.debug("No base URL configured for provider", { providerID })
    return { error: `No base URL configured for provider: ${providerID}` }
  }

  const handler = HANDLERS[providerID]
  if (!handler) {
    log.debug("No plan usage handler for provider", { providerID })
    return { error: `No plan usage handler for provider: ${providerID}` }
  }

  return handler({ token: config.token, baseURL: config.baseURL, timeout })
}

export async function fetchPlanUsageWithCache(
  providerID: string,
  providers: Array<Record<string, unknown>>,
  timeout = 5000,
): Promise<PlanUsageData> {
  const key = `planUsage:${providerID}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.data

  const data = await fetchPlanUsage(providerID, providers, timeout)
  cache.set(key, { data, time: Date.now() })
  return data
}

export function formatResetTime(date?: Date): string | null {
  if (!date) return null

  const now = Date.now()
  const remaining = Math.max(0, date.getTime() - now) / 1000
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = Math.floor(remaining % 60)

  if (h > 24) return `Resets in ${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `Resets in ${h}h ${m}m`
  if (m > 0) return `Resets in ${m}m`
  if (s > 0) return `Resets in ${s}s`
  return "Resets soon"
}

async function getProviderConfig(providerID: string, providers: Array<Record<string, unknown>>) {
  const { Auth } = await import("@/auth")
  const auth = await Auth.get(providerID)
  const token = auth?.type === "api" ? auth.key : null

  const provider = providers.find((p) => p.id === providerID)
  const models = provider?.models as Record<string, { api?: { url?: string } }> | undefined
  const firstModel = models ? Object.values(models)[0] : undefined
  const baseURL = firstModel?.api?.url ?? null

  return { token, baseURL }
}
