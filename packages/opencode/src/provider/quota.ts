import { Auth } from "../auth"

export namespace Quota {
  export type Status = {
    used?: number
    total?: number
    remaining?: number
    /** 0–100 percentage used, if calculable */
    percent?: number
    resetAt?: Date
    label?: string
    error?: string
  }

  /**
   * Fetches quota/usage information for a provider.
   * Returns undefined if no quota API is supported for the provider.
   * Never throws — errors are captured in the returned Status.
   */
  export async function fetch(providerID: string): Promise<Status | undefined> {
    const base = providerBaseID(providerID)
    const handler = HANDLERS[base]
    if (!handler) return undefined
    try {
      return await handler(providerID)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Format a Status for display in the CLI. */
  export function format(status: Status): string {
    if (status.error) return `error: ${status.error}`
    const parts: string[] = []
    if (status.label) parts.push(status.label)
    else if (status.remaining !== undefined && status.total !== undefined) {
      parts.push(`${status.remaining}/${status.total}`)
    } else if (status.percent !== undefined) {
      parts.push(`${Math.round(status.percent)}% used`)
    } else if (status.remaining !== undefined) {
      parts.push(`${status.remaining} remaining`)
    }
    if (status.resetAt) {
      const diff = status.resetAt.getTime() - Date.now()
      if (diff > 0) parts.push(`resets in ${humanDuration(diff)}`)
    }
    return parts.join(" · ")
  }

  function humanDuration(ms: number): string {
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ${m % 60}m`
    return `${Math.floor(h / 24)}d`
  }

  function providerBaseID(providerID: string): string {
    const scoped = providerID.split(":")[0]
    const emailMatch = scoped.match(/^(.*)-([^-]+@.+)$/)
    if (emailMatch) return emailMatch[1]
    const numericMatch = scoped.match(/^(.*)-(\d+)$/)
    if (numericMatch) return numericMatch[1]
    return scoped
  }

  type Handler = (providerID: string) => Promise<Status>

  // ──────────────────────────────────────────────────────────────────────────
  // Google Antigravity
  // Uses the internal CodeAssist API that Gemini CLI also uses.
  // ──────────────────────────────────────────────────────────────────────────
  async function googleQuota(providerID: string): Promise<Status> {
    const auth = await Auth.getWithRefresh(providerID)
    if (!auth || auth.type === "wellknown") return { error: "no auth" }
    const token = auth.type === "oauth" ? auth.access : auth.key

    const resp = await globalThis.fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED" } }),
      signal: AbortSignal.timeout(8000),
    })

    if (!resp.ok) return { error: `HTTP ${resp.status}` }
    const json = await resp.json() as Record<string, unknown>

    const available = json.availablePromptCredits
    const total = json.monthlyPromptCredits
    if (typeof available !== "number" || typeof total !== "number") return { error: "unexpected response" }

    const used = total - available
    const percent = total > 0 ? (used / total) * 100 : undefined
    return {
      used,
      total,
      remaining: available,
      percent,
      label: `${available.toLocaleString()}/${total.toLocaleString()} credits`,
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Anthropic — rate limit info from response headers on a lightweight call
  // ──────────────────────────────────────────────────────────────────────────
  async function anthropicQuota(providerID: string): Promise<Status> {
    const auth = await Auth.getWithRefresh(providerID)
    if (!auth) return { error: "no auth" }
    const apiKey = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
    if (!apiKey) return { error: "no api key" }

    const resp = await globalThis.fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(8000),
    })

    // We only care about the rate-limit headers, not the body
    const remaining = Number(resp.headers.get("anthropic-ratelimit-requests-remaining") ?? NaN)
    const limit = Number(resp.headers.get("anthropic-ratelimit-requests-limit") ?? NaN)
    const resetAt = resp.headers.get("anthropic-ratelimit-requests-reset")

    if (!resp.ok && resp.status !== 200) return { error: `HTTP ${resp.status}` }

    const parts: string[] = []
    if (!isNaN(remaining) && !isNaN(limit)) {
      parts.push(`${remaining}/${limit} req/min`)
    }

    const tokenRemaining = Number(resp.headers.get("anthropic-ratelimit-tokens-remaining") ?? NaN)
    const tokenLimit = Number(resp.headers.get("anthropic-ratelimit-tokens-limit") ?? NaN)
    if (!isNaN(tokenRemaining) && !isNaN(tokenLimit)) {
      parts.push(`${tokenRemaining.toLocaleString()}/${tokenLimit.toLocaleString()} tok/min`)
    }

    return {
      remaining: isNaN(remaining) ? undefined : remaining,
      total: isNaN(limit) ? undefined : limit,
      percent: !isNaN(remaining) && !isNaN(limit) && limit > 0 ? ((limit - remaining) / limit) * 100 : undefined,
      resetAt: resetAt ? new Date(resetAt) : undefined,
      label: parts.length > 0 ? parts.join(", ") : undefined,
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  const HANDLERS: Record<string, Handler> = {
    google: googleQuota,
    anthropic: anthropicQuota,
  }
}
