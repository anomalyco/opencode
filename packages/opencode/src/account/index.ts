import path from "path"
import { homedir } from "os"
import z from "zod"

export namespace Account {
  export const Status = z.enum(["active", "rate_limited", "cooling_down", "unknown"])
  export type Status = z.infer<typeof Status>

  export const ModelQuota = z.object({
    name: z.string(),
    displayName: z.string(),
    percentage: z.number(),
    resetTime: z.number().optional(),
  })
  export type ModelQuota = z.infer<typeof ModelQuota>

  export const Entry = z
    .object({
      id: z.string(),
      provider: z.string(),
      providerType: z.enum(["openai", "antigravity"]),
      type: z.enum(["oauth", "api", "wellknown", "multi"]),
      email: z.string().optional(),
      accountId: z.string().optional(),
      status: Status,
      index: z.number().optional(),
      isActive: z.boolean().optional(),
      lastUsed: z.number().optional(),
      quotas: z.array(ModelQuota).optional(),
      subscriptionTier: z.string().optional(),
    })
    .meta({ ref: "AccountEntry" })
  export type Entry = z.infer<typeof Entry>

  const MODEL_DISPLAY_NAMES: Record<string, string> = {
    claude: "Claude 4.5",
    "gemini-antigravity:antigravity-gemini-3-pro": "G3 Pro",
    "gemini-antigravity:antigravity-gemini-3-pro-image": "G3 Image",
    "gemini-cli:gemini-3-flash-preview": "G3 Flash",
    "gemini-cli:gemini-3-pro-preview": "G3 Pro",
    codex: "Codex",
    "codex-primary": "Primary (5H)",
    "codex-secondary": "Secondary (W)",
  }

  function getDisplayName(modelKey: string): string {
    if (MODEL_DISPLAY_NAMES[modelKey]) {
      return MODEL_DISPLAY_NAMES[modelKey]
    }
    const lowerKey = modelKey.toLowerCase()
    if (lowerKey.includes("claude")) return "Claude 4.5"
    if (lowerKey.includes("gemini-3-pro") && lowerKey.includes("image")) return "G3 Image"
    if (lowerKey.includes("gemini-3-pro")) return "G3 Pro"
    if (lowerKey.includes("gemini-3-flash") || lowerKey.includes("flash")) return "G3 Flash"
    if (lowerKey.includes("codex-primary") || lowerKey === "primary") return "Primary (5H)"
    if (lowerKey.includes("codex-secondary") || lowerKey === "secondary") return "Secondary (W)"
    return (
      modelKey
        .split(":")
        .pop()
        ?.replace(/-/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()) || modelKey
    )
  }

  function getOpenAIMultiPath(): string {
    return path.join(homedir(), ".opencode", "openai-codex-accounts.json")
  }

  function getAntigravityPath(): string {
    const platform = process.platform
    if (platform === "win32") {
      return path.join(
        process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"),
        "opencode",
        "antigravity-accounts.json",
      )
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config")
    return path.join(xdgConfig, "opencode", "antigravity-accounts.json")
  }

  const QUOTA_WINDOW_MS = 5 * 60 * 60 * 1000

  function parseQuotas(rateLimitResetTimes: Record<string, unknown> | undefined, now: number): ModelQuota[] {
    if (!rateLimitResetTimes || typeof rateLimitResetTimes !== "object") return []

    const quotas: ModelQuota[] = []
    for (const [key, resetTime] of Object.entries(rateLimitResetTimes)) {
      if (typeof resetTime !== "number") continue

      const isRecovered = resetTime <= now
      const timeRemaining = isRecovered ? 0 : resetTime - now
      const percentage = isRecovered ? 100 : Math.max(0, 100 - Math.round((timeRemaining / QUOTA_WINDOW_MS) * 100))

      quotas.push({
        name: key,
        displayName: getDisplayName(key),
        percentage,
        resetTime: isRecovered ? undefined : resetTime,
      })
    }
    return quotas
  }

  async function readOpenAIMultiAccounts(): Promise<Entry[]> {
    const filepath = getOpenAIMultiPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return []

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return []
    if (data.version !== 3 || !Array.isArray(data.accounts)) return []

    const now = Date.now()
    const activeIndex = typeof data.activeIndex === "number" ? data.activeIndex : 0

    return data.accounts.map((acc: Record<string, unknown>, idx: number): Entry => {
      const status: Status = (() => {
        if (typeof acc.coolingDownUntil === "number" && acc.coolingDownUntil > now) return "cooling_down"
        if (acc.rateLimitResetTimes && typeof acc.rateLimitResetTimes === "object") {
          const hasActiveLimit = Object.values(acc.rateLimitResetTimes as Record<string, unknown>).some(
            (time) => typeof time === "number" && time > now,
          )
          if (hasActiveLimit) return "rate_limited"
        }
        return "active"
      })()

      const quotas = parseQuotas(acc.rateLimitResetTimes as Record<string, unknown> | undefined, now)

      return {
        id: `openai-multi-${idx}`,
        provider: "OpenAI",
        providerType: "openai",
        type: "multi",
        email: typeof acc.email === "string" ? acc.email : undefined,
        accountId: typeof acc.accountId === "string" ? acc.accountId : undefined,
        status,
        index: idx,
        isActive: idx === activeIndex,
        lastUsed: typeof acc.lastUsed === "number" ? acc.lastUsed : undefined,
        quotas,
        subscriptionTier: typeof acc.subscriptionTier === "string" ? acc.subscriptionTier : undefined,
      }
    })
  }

  async function readAntigravityAccounts(): Promise<Entry[]> {
    const filepath = getAntigravityPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return []

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return []
    if (data.version !== 3 || !Array.isArray(data.accounts)) return []

    const now = Date.now()
    const activeIndex = typeof data.activeIndex === "number" ? data.activeIndex : 0

    return data.accounts.map((acc: Record<string, unknown>, idx: number): Entry => {
      const status: Status = (() => {
        if (typeof acc.coolingDownUntil === "number" && acc.coolingDownUntil > now) return "cooling_down"
        if (acc.rateLimitResetTimes && typeof acc.rateLimitResetTimes === "object") {
          const hasActiveLimit = Object.values(acc.rateLimitResetTimes as Record<string, unknown>).some(
            (time) => typeof time === "number" && time > now,
          )
          if (hasActiveLimit) return "rate_limited"
        }
        return "active"
      })()

      const quotas = parseQuotas(acc.rateLimitResetTimes as Record<string, unknown> | undefined, now)

      return {
        id: `antigravity-${idx}`,
        provider: "Antigravity",
        providerType: "antigravity",
        type: "multi",
        email: typeof acc.email === "string" ? acc.email : undefined,
        accountId: typeof acc.projectId === "string" ? acc.projectId : undefined,
        status,
        index: idx,
        isActive: idx === activeIndex,
        lastUsed: typeof acc.lastUsed === "number" ? acc.lastUsed : undefined,
        quotas,
        subscriptionTier: typeof acc.subscriptionTier === "string" ? acc.subscriptionTier : undefined,
      }
    })
  }

  export async function list(): Promise<Entry[]> {
    const [openai, antigravity] = await Promise.all([readOpenAIMultiAccounts(), readAntigravityAccounts()])
    return [...openai, ...antigravity]
  }

  export async function setActive(accountId: string): Promise<boolean> {
    const [providerType, indexStr] = accountId.split("-").slice(0, 2)

    if (providerType === "openai" || accountId.startsWith("openai-multi-")) {
      const index = parseInt(accountId.replace("openai-multi-", ""), 10)
      if (isNaN(index)) return false
      return setActiveOpenAI(index)
    } else if (providerType === "antigravity" || accountId.startsWith("antigravity-")) {
      const index = parseInt(accountId.replace("antigravity-", ""), 10)
      if (isNaN(index)) return false
      return setActiveAntigravity(index)
    }
    return false
  }

  async function setActiveOpenAI(index: number): Promise<boolean> {
    const filepath = getOpenAIMultiPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return false

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return false
    if (!Array.isArray(data.accounts) || index < 0 || index >= data.accounts.length) return false

    data.activeIndex = index
    await Bun.write(filepath, JSON.stringify(data, null, 2))
    return true
  }

  async function setActiveAntigravity(index: number): Promise<boolean> {
    const filepath = getAntigravityPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return false

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return false
    if (!Array.isArray(data.accounts) || index < 0 || index >= data.accounts.length) return false

    data.activeIndex = index
    await Bun.write(filepath, JSON.stringify(data, null, 2))
    return true
  }

  export async function remove(accountId: string): Promise<boolean> {
    if (accountId.startsWith("openai-multi-")) {
      const index = parseInt(accountId.replace("openai-multi-", ""), 10)
      if (isNaN(index)) return false
      return removeOpenAI(index)
    } else if (accountId.startsWith("antigravity-")) {
      const index = parseInt(accountId.replace("antigravity-", ""), 10)
      if (isNaN(index)) return false
      return removeAntigravity(index)
    }
    return false
  }

  async function removeOpenAI(index: number): Promise<boolean> {
    const filepath = getOpenAIMultiPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return false

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return false
    if (!Array.isArray(data.accounts) || index < 0 || index >= data.accounts.length) return false

    data.accounts.splice(index, 1)
    if (data.activeIndex >= data.accounts.length) {
      data.activeIndex = Math.max(0, data.accounts.length - 1)
    } else if (data.activeIndex > index) {
      data.activeIndex--
    }

    await Bun.write(filepath, JSON.stringify(data, null, 2))
    return true
  }

  async function removeAntigravity(index: number): Promise<boolean> {
    const filepath = getAntigravityPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return false

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return false
    if (!Array.isArray(data.accounts) || index < 0 || index >= data.accounts.length) return false

    data.accounts.splice(index, 1)
    if (data.activeIndex >= data.accounts.length) {
      data.activeIndex = Math.max(0, data.accounts.length - 1)
    } else if (data.activeIndex > index) {
      data.activeIndex--
    }

    await Bun.write(filepath, JSON.stringify(data, null, 2))
    return true
  }

  export async function clearRateLimits(accountId: string): Promise<boolean> {
    if (accountId.startsWith("openai-multi-")) {
      const index = parseInt(accountId.replace("openai-multi-", ""), 10)
      if (isNaN(index)) return false
      return clearRateLimitsOpenAI(index)
    } else if (accountId.startsWith("antigravity-")) {
      const index = parseInt(accountId.replace("antigravity-", ""), 10)
      if (isNaN(index)) return false
      return clearRateLimitsAntigravity(index)
    }
    return false
  }

  async function clearRateLimitsOpenAI(index: number): Promise<boolean> {
    const filepath = getOpenAIMultiPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return false

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return false
    if (!Array.isArray(data.accounts) || index < 0 || index >= data.accounts.length) return false

    data.accounts[index].rateLimitResetTimes = {}
    data.accounts[index].coolingDownUntil = 0

    await Bun.write(filepath, JSON.stringify(data, null, 2))
    return true
  }

  async function clearRateLimitsAntigravity(index: number): Promise<boolean> {
    const filepath = getAntigravityPath()
    const file = Bun.file(filepath)

    if (!(await file.exists())) return false

    const data = await file.json().catch(() => null)
    if (!data || typeof data !== "object") return false
    if (!Array.isArray(data.accounts) || index < 0 || index >= data.accounts.length) return false

    data.accounts[index].rateLimitResetTimes = {}
    data.accounts[index].coolingDownUntil = 0

    await Bun.write(filepath, JSON.stringify(data, null, 2))
    return true
  }

  export function formatTimeRemaining(resetTime: number | undefined): string {
    if (!resetTime) return "Ready"
    const diffMs = resetTime - Date.now()
    if (diffMs <= 0) return "Ready"

    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)

    if (hours >= 24) {
      const days = Math.floor(hours / 24)
      const remainingHrs = hours % 24
      return `${days}d ${remainingHrs}h`
    }

    return `${hours}h ${mins}m`
  }

  export function createProgressBar(percentage: number, width: number = 10): string {
    const filled = Math.round((percentage / 100) * width)
    const empty = width - filled
    return "█".repeat(filled) + "░".repeat(empty)
  }

  export type QuotaColorType = "success" | "warning" | "error"

  export function getQuotaColor(percentage: number): QuotaColorType {
    if (percentage >= 80) return "success"
    if (percentage >= 40) return "warning"
    return "error"
  }
}
