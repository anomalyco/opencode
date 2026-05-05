import type { CapabilitiesInput } from "../llm"
import { ProviderResolver, type ProviderResolution } from "../provider-resolver"

export interface OpenAICompatibleProfile {
  readonly provider: string
  readonly baseURL?: string
  readonly capabilities?: CapabilitiesInput
  readonly resolver?: Partial<Omit<ProviderResolution, "provider" | "protocol">>
}

export const profiles = {
  baseten: { provider: "baseten", baseURL: "https://inference.baseten.co/v1" },
  cerebras: { provider: "cerebras", baseURL: "https://api.cerebras.ai/v1" },
  deepinfra: { provider: "deepinfra", baseURL: "https://api.deepinfra.com/v1/openai" },
  deepseek: { provider: "deepseek", baseURL: "https://api.deepseek.com/v1" },
  fireworks: { provider: "fireworks", baseURL: "https://api.fireworks.ai/inference/v1" },
  openrouter: { provider: "openrouter", baseURL: "https://openrouter.ai/api/v1" },
  togetherai: { provider: "togetherai", baseURL: "https://api.together.xyz/v1" },
} as const satisfies Record<string, OpenAICompatibleProfile>

export const byProvider: Record<string, OpenAICompatibleProfile> = Object.fromEntries(
  Object.values(profiles).map((profile) => [profile.provider, profile]),
)

export const resolution = (profile: OpenAICompatibleProfile) =>
  ProviderResolver.make(profile.provider, "openai-compatible-chat", {
    baseURL: profile.baseURL,
    capabilities: profile.capabilities,
    ...profile.resolver,
  })

export const resolve = (provider: string) => {
  const profile = byProvider[provider]
  if (profile) return resolution(profile)
  return ProviderResolver.make(provider, "openai-compatible-chat")
}

export const resolverFor = (profile: OpenAICompatibleProfile) =>
  ProviderResolver.define({
    id: ProviderResolver.make(profile.provider, "openai-compatible-chat").provider,
    resolve: () => resolution(profile),
  })

export const resolver = ProviderResolver.define({
  id: ProviderResolver.make("openai-compatible", "openai-compatible-chat").provider,
  resolve: (input) => resolve(input.providerID),
})

export * as OpenAICompatibleProfiles from "./openai-compatible-profile"
