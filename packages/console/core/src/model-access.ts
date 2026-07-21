export namespace ModelAccess {
  export const providers = ["anthropic", "openai"] as const
  export type Provider = (typeof providers)[number]

  export function parseProvider(value: string): Provider {
    if (providers.includes(value as Provider)) return value as Provider
    throw new Error(`Unsupported model provider: ${value}`)
  }

  export function provider(model: string): Provider | undefined {
    if (model.startsWith("claude")) return "anthropic"
    if (model.startsWith("gpt")) return "openai"
  }

  export function blocked(model: string, providers: Provider[] | null) {
    const value = provider(model)
    if (!value) return false
    return providers?.includes(value) ?? false
  }

  export function label(provider: Provider) {
    if (provider === "anthropic") return { provider: "Anthropic", models: "Claude" }
    return { provider: "OpenAI", models: "GPT" }
  }
}
