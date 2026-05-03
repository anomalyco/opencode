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
  groq: { provider: "groq", baseURL: "https://api.groq.com/openai/v1" },
  mistral: { provider: "mistral", baseURL: "https://api.mistral.ai/v1" },
  openrouter: { provider: "openrouter", baseURL: "https://openrouter.ai/api/v1" },
  perplexity: { provider: "perplexity", baseURL: "https://api.perplexity.ai" },
  togetherai: { provider: "togetherai", baseURL: "https://api.together.xyz/v1" },
  venice: { provider: "venice", baseURL: "https://api.venice.ai/api/v1" },
} as const satisfies Record<string, ProviderFamily>

export const byProvider: Record<string, ProviderFamily> = Object.fromEntries(
  Object.values(families).map((family) => [family.provider, family]),
)

const resolutions = Object.fromEntries(
  Object.values(families).map((family) => [
    family.provider,
    ProviderResolver.make(family.provider, "openai-compatible-chat", { baseURL: family.baseURL }),
  ]),
)

export const resolve = (provider: string) =>
  resolutions[provider] ?? ProviderResolver.make(provider, "openai-compatible-chat")

export const resolver = ProviderResolver.define({
  id: ProviderResolver.make("openai-compatible", "openai-compatible-chat").provider,
  resolve: (input) => resolve(input.providerID),
})

export * as OpenAICompatibleFamily from "./openai-compatible-family"
