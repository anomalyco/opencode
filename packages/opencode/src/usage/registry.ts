import type { Auth } from "@/auth"
import { fetchAntigravityUsageWithAuth } from "./providers/antigravity"
import { fetchClaudeUsage } from "./providers/anthropic"
import { fetchCopilotUsage } from "./providers/github-copilot"
import { fetchChatgptUsageWithAuth } from "./providers/openai"
import type { UsageFetchResult } from "./types"

type OAuthAuth = Extract<Auth.Info, { type: "oauth" }>

export type UsageFetchInput = {
  auth: OAuthAuth
}

export type UsageProviderInfo = {
  authKeys: readonly string[]
  displayName: string
  fetch: (input: UsageFetchInput) => Promise<UsageFetchResult>
  allowMissingAccess?: boolean
  oauthRequiredMessage?: string
  requiresOAuth: boolean
}

// Providers are listed in alphabetical order by company name. Display order
// follows this declaration order end-to-end (see usage/usage.ts getAuthenticatedProviders
// and the HttpApi usage handler response mapping, both preserve order).
export const usageProviders = {
  anthropic: {
    authKeys: ["anthropic"],
    displayName: "Anthropic Claude",
    fetch: ({ auth }: UsageFetchInput) => fetchClaudeUsage(auth),
    oauthRequiredMessage:
      "Claude usage requires Anthropic OAuth credentials. Anthropic API key auth cannot access Claude usage; authenticate with an OAuth-capable Claude plugin.",
    requiresOAuth: true,
  },
  "github-copilot": {
    authKeys: ["github-copilot"],
    displayName: "GitHub Copilot",
    fetch: ({ auth }: UsageFetchInput) =>
      fetchCopilotUsage({
        access: auth.access,
        refresh: auth.refresh,
        enterpriseUrl: auth.enterpriseUrl,
      }),
    requiresOAuth: true,
  },
  google: {
    authKeys: ["google"],
    displayName: "Google Antigravity",
    allowMissingAccess: true,
    fetch: ({ auth }: UsageFetchInput) => fetchAntigravityUsageWithAuth(auth),
    oauthRequiredMessage:
      "Google Antigravity usage requires OAuth credentials. API key auth cannot access Antigravity usage; authenticate with an OAuth-capable Antigravity auth plugin.",
    requiresOAuth: true,
  },
  openai: {
    authKeys: ["openai"],
    displayName: "OpenAI ChatGPT",
    fetch: ({ auth }: UsageFetchInput) => fetchChatgptUsageWithAuth(auth),
    requiresOAuth: true,
  },
} as const

export type UsageProviderId = keyof typeof usageProviders

export function isUsageProvider(provider: string): provider is UsageProviderId {
  return Object.hasOwn(usageProviders, provider)
}

export function getUsageProviderInfo(provider: string): UsageProviderInfo | null {
  if (!isUsageProvider(provider)) return null
  return usageProviders[provider]
}

export function listUsageProviders(): Array<{ id: UsageProviderId } & UsageProviderInfo> {
  const providers = Object.keys(usageProviders) as UsageProviderId[]
  return providers.map((id) => ({ id, ...usageProviders[id] }))
}
