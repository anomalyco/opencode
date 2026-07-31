export * as AISDKNative from "./aisdk-native"

import { Option, Schema } from "effect"

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

const XAIOptions = Schema.Struct({
  reasoningEffort: Schema.Literals(["none", "low", "medium", "high"]).pipe(Schema.optional),
  store: Schema.Boolean.pipe(Schema.optional),
  promptCacheKey: Schema.String.pipe(Schema.optional),
  include: Schema.NullOr(Schema.Array(Schema.Literal("file_search_call.results"))).pipe(Schema.optional),
})

function mapXAIOptions(settings: Readonly<Record<string, unknown>>) {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(XAIOptions)(settings))
  if (!decoded) return {}
  const { include, ...rest } = decoded
  const options = {
    ...rest,
    ...(include && include.length > 0 ? { include } : {}),
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
