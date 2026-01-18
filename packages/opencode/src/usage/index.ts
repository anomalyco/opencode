import { Auth } from "@/auth"
import type { ProviderUsage, UsageSnapshot } from "./types"
import { fetchOpenAIUsage } from "./providers/openai"
import { fetchAnthropicUsage } from "./providers/anthropic"
import { fetchCopilotUsage } from "./providers/copilot"
import { fetchAntigravityUsage } from "./providers/antigravity"

export type { ProviderUsage, RateWindow, UsageSnapshot } from "./types"

export interface UsageFetchOptions {
  providers?: string[]
}

// Providers that use API keys and have no rate limits (pay-per-use)
const UNLIMITED_PROVIDERS: Record<string, string> = {
  opencode: "OpenCode Zen",
}

export namespace Usage {
  export async function fetch(options: UsageFetchOptions = {}): Promise<UsageSnapshot> {
    const authMap = await Auth.all()
    const providers: ProviderUsage[] = []
    const filter = options.providers && options.providers.length > 0 ? new Set(options.providers) : null
    const shouldInclude = (id: string) => !filter || filter.has(id)

    const fetchers: Array<{ id: string; fn: () => Promise<ProviderUsage | null> }> = []

    // Check for unlimited providers first
    for (const [providerId, label] of Object.entries(UNLIMITED_PROVIDERS)) {
      if (!shouldInclude(providerId)) continue
      if (authMap[providerId]) {
        providers.push({
          providerId,
          providerLabel: label,
          status: "unlimited",
        })
      }
    }

    if (shouldInclude("openai") && authMap["openai"]) {
      fetchers.push({ id: "openai", fn: () => fetchOpenAIUsage(authMap["openai"]!) })
    }

    if (shouldInclude("anthropic") && authMap["anthropic"]) {
      fetchers.push({ id: "anthropic", fn: () => fetchAnthropicUsage(authMap["anthropic"]!) })
    }

    if (shouldInclude("github-copilot")) {
      // Always try Copilot - it has its own token storage for usage
      const copilotAuth = authMap["github-copilot-enterprise"] ?? authMap["github-copilot"] ?? null
      fetchers.push({ id: "github-copilot", fn: () => fetchCopilotUsage(copilotAuth) })
    }

    if (shouldInclude("antigravity")) {
      fetchers.push({ id: "antigravity", fn: () => fetchAntigravityUsage() })
    }

    const results = await Promise.allSettled(fetchers.map((f) => f.fn()))

    for (let i = 0; i < fetchers.length; i++) {
      const result = results[i]
      const fetcher = fetchers[i]
      if (result.status === "fulfilled" && result.value) {
        providers.push(result.value)
      } else if (result.status === "rejected") {
        providers.push({
          providerId: fetcher.id,
          providerLabel: getLabelForProvider(fetcher.id),
          status: "error",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }

    return { providers, fetchedAt: new Date().toISOString() }
  }
}

function getLabelForProvider(id: string): string {
  const labels: Record<string, string> = {
    openai: "OpenAI/Codex",
    anthropic: "Anthropic/Claude",
    "github-copilot": "GitHub Copilot",
    antigravity: "Antigravity",
  }
  return labels[id] ?? id
}
