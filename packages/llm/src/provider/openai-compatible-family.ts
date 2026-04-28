import { ProviderResolver } from "../provider-resolver"

export interface ProviderFamily {
  readonly provider: string
  readonly baseURL: string
}

export const families = {
  baseten: { provider: "baseten", baseURL: "https://inference.baseten.co/v1" },
  cerebras: { provider: "cerebras", baseURL: "https://api.cerebras.ai/v1" },
  deepinfra: { provider: "deepinfra", baseURL: "https://api.deepinfra.com/v1/openai" },
  deepseek: { provider: "deepseek", baseURL: "https://api.deepseek.com/v1" },
  fireworks: { provider: "fireworks", baseURL: "https://api.fireworks.ai/inference/v1" },
  togetherai: { provider: "togetherai", baseURL: "https://api.together.xyz/v1" },
} as const satisfies Record<string, ProviderFamily>

export const byProvider: Record<string, ProviderFamily> = Object.fromEntries(
  Object.values(families).map((family) => [family.provider, family]),
)

export const resolve = (provider: string) =>
  ProviderResolver.make(provider, "openai-compatible-chat", { baseURL: byProvider[provider]?.baseURL, auth: "bearer" })

export const resolver = ProviderResolver.define({
  id: ProviderResolver.make("openai-compatible", "openai-compatible-chat").provider,
  resolve: (input) => resolve(input.providerID),
})

export * as OpenAICompatibleFamily from "./openai-compatible-family"
