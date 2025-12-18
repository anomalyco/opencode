import type { Hooks } from "@opencode-ai/plugin"
import type { ProviderAuthAdapter } from "./adapter"
import { AnthropicSubscriptionAdapter } from "./providers/anthropic"
import { OpenAISubscriptionAdapter } from "./providers/openai"
import { GoogleGeminiSubscriptionAdapter } from "./providers/google"
import { GitHubCopilotSubscriptionAdapter } from "./providers/github-copilot"
import { QwenSubscriptionAdapter } from "./providers/qwen"
import { CursorSubscriptionAdapter } from "./providers/cursor"

const ADAPTERS: ProviderAuthAdapter[] = [
  AnthropicSubscriptionAdapter,
  OpenAISubscriptionAdapter,
  GoogleGeminiSubscriptionAdapter,
  GitHubCopilotSubscriptionAdapter,
  QwenSubscriptionAdapter,
  CursorSubscriptionAdapter,
]

const ALIASES: Record<string, string> = {
  "github-copilot-enterprise": "github-copilot",
}

export namespace ProviderAuthRegistry {
  export function equivalentProviderIds(providerId: string): string[] {
    const canonical = resolveProviderId(providerId)
    const ids = new Set<string>([canonical, providerId])
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (target === canonical) ids.add(alias)
    }
    return Array.from(ids)
      .filter(Boolean)
      .sort((a, b) => {
        if (a === canonical) return -1
        if (b === canonical) return 1
        return a.localeCompare(b)
      })
  }

  export function listProviderIds(): string[] {
    const ids = new Set<string>()
    for (const adapter of ADAPTERS) ids.add(adapter.providerId)
    for (const alias of Object.keys(ALIASES)) ids.add(alias)
    return Array.from(ids).sort()
  }

  export function resolveProviderId(providerId: string): string {
    return ALIASES[providerId] ?? providerId
  }

  export function getAdapter(providerId: string): ProviderAuthAdapter | undefined {
    const resolved = resolveProviderId(providerId)
    return ADAPTERS.find((a) => a.providerId === resolved)
  }

  export function getAuthHook(providerId: string): Hooks["auth"] | undefined {
    const adapter = getAdapter(providerId)
    if (!adapter) return undefined
    const methods = [...adapter.authMethods()]
    if (!methods.some((m) => m.type === "api")) {
      methods.push({
        type: "api",
        label: "API key",
      } as any)
    }
    return {
      provider: providerId,
      methods,
    }
  }
}
