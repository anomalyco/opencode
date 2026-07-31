export * as AISDKNative from "./aisdk-native"

export interface Mapping {
  readonly package: string
  readonly settings: Readonly<Record<string, unknown>>
}

export function map(packageName: string | undefined, settings: Readonly<Record<string, unknown>>): Mapping | undefined {
  const baseSettings = mapBaseSettings(settings)
  switch (packageName) {
    case "@ai-sdk/google":
      return {
        package: "@opencode-ai/ai/providers/google",
        settings: {
          ...baseSettings,
          ...mapAPIKey(settings),
          ...mapProviderOptions("gemini", settings),
        },
      }
    case "@openrouter/ai-sdk-provider":
      return {
        package: "@opencode-ai/ai/providers/openrouter",
        settings: {
          ...baseSettings,
          ...mapAPIKey(settings),
          ...mapProviderOptions("openrouter", settings),
        },
      }
    case "@ai-sdk/xai":
      return {
        package: "@opencode-ai/ai/providers/xai",
        settings: {
          ...baseSettings,
          ...mapAPIKey(settings),
          ...mapXAIOptions(settings),
        },
      }
  }
}

function mapBaseSettings(settings: Readonly<Record<string, unknown>>) {
  return {
    ...(typeof settings.baseURL === "string" ? { baseURL: settings.baseURL } : {}),
  }
}

function mapAPIKey(settings: Readonly<Record<string, unknown>>) {
  return typeof settings.apiKey === "string" ? { apiKey: settings.apiKey } : {}
}

function mapXAIOptions(settings: Readonly<Record<string, unknown>>) {
  const include = Array.isArray(settings.include)
    ? settings.include.filter((value): value is "file_search_call.results" => value === "file_search_call.results")
    : []
  const options = {
    ...(settings.reasoningEffort === "none" ||
    settings.reasoningEffort === "low" ||
    settings.reasoningEffort === "medium" ||
    settings.reasoningEffort === "high"
      ? { reasoningEffort: settings.reasoningEffort }
      : {}),
    ...(typeof settings.store === "boolean" ? { store: settings.store } : {}),
    ...(typeof settings.promptCacheKey === "string" ? { promptCacheKey: settings.promptCacheKey } : {}),
    ...(include.length > 0 ? { include } : {}),
  }
  if (Object.keys(options).length === 0) return {}
  return { providerOptions: { xai: options } }
}

function mapProviderOptions(namespace: string, settings: Readonly<Record<string, unknown>>) {
  const values = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !["apiKey", "authToken", "baseURL", "chunkTimeout", "fetch", "timeout"].includes(key),
    ),
  )
  if (Object.keys(values).length === 0) return {}
  return { providerOptions: { [namespace]: values } }
}
