import type { Config, ProviderListResponse } from "@opencode-ai/sdk/v2/client"

type ProviderCfg = NonNullable<Config["provider"]>[string]
type ProviderModelMap = ProviderListResponse["all"][number]["models"]

export function providerSdkFromModels(models: ProviderModelMap): string | undefined {
  const counts = new Map<string, number>()
  for (const model of Object.values(models)) {
    const sdk = model.api.npm
    if (!sdk) continue
    counts.set(sdk, (counts.get(sdk) ?? 0) + 1)
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
}

export function providerDisplaySdk(input: {
  config?: ProviderCfg
  models: ProviderModelMap
}): { sdk?: string; custom: boolean } {
  const configuredSdk = input.config?.npm
  return {
    sdk: configuredSdk ?? providerSdkFromModels(input.models),
    custom: typeof configuredSdk === "string" && configuredSdk.startsWith("@ai-sdk/"),
  }
}
