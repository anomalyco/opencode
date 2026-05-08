import {
  LLM,
  ReasoningEffort as ReasoningEffortSchema,
  TextVerbosity as TextVerbositySchema,
  mergeProviderOptions,
  type ModelRef,
  type ProviderOptions,
} from "@opencode-ai/llm"
import { AmazonBedrock, Anthropic, Azure, GitHubCopilot, Google, OpenAI, OpenAICompatible, OpenRouter, XAI } from "@opencode-ai/llm/providers"
import * as OpenAICompatibleProfiles from "@opencode-ai/llm/providers/openai-compatible-profile"
import { Option, Schema } from "effect"
import { isRecord } from "@/util/record"
import type * as Provider from "./provider"

type Input = {
  readonly provider: Provider.Info
  readonly model: Provider.Model
}

const decodeReasoningEffort = Schema.decodeUnknownOption(ReasoningEffortSchema)
const decodeTextVerbosity = Schema.decodeUnknownOption(TextVerbositySchema)

const stringOption = (options: Record<string, unknown>, key: string) => {
  const value = options[key]
  if (typeof value === "string" && value.trim() !== "") return value
  return undefined
}

const recordOption = (options: Record<string, unknown>, key: string): Record<string, string> => {
  const value = options[key]
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

const configuredProviderOptions = (options: Record<string, unknown>): ProviderOptions | undefined => {
  if (!isRecord(options.providerOptions)) return undefined
  const result = Object.fromEntries(
    Object.entries(options.providerOptions).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])),
  )
  return Object.keys(result).length === 0 ? undefined : result
}

const openAIOptions = (
  options: Record<string, unknown>,
  configured: ProviderOptions | undefined = configuredProviderOptions(options),
): ProviderOptions | undefined => {
  const openai = Object.fromEntries(Object.entries({
    store: typeof options.store === "boolean" ? options.store : undefined,
    promptCacheKey: stringOption(options, "promptCacheKey"),
    reasoningEffort: Option.getOrUndefined(decodeReasoningEffort(options.reasoningEffort)),
    reasoningSummary: options.reasoningSummary === "auto" ? "auto" : undefined,
    includeEncryptedReasoning: Array.isArray(options.include) && options.include.includes("reasoning.encrypted_content") ? true : undefined,
    textVerbosity: Option.getOrUndefined(decodeTextVerbosity(options.textVerbosity)),
  }).filter((entry) => entry[1] !== undefined))
  return mergeProviderOptions(
    configured,
    Object.keys(openai).length === 0 ? undefined : { openai },
  )
}

const openRouterOptions = (
  options: Record<string, unknown>,
  configured: ProviderOptions | undefined = configuredProviderOptions(options),
): ProviderOptions | undefined => {
  const openrouter = Object.fromEntries(Object.entries({
    usage: options.usage === true || isRecord(options.usage) ? options.usage : undefined,
    reasoning: isRecord(options.reasoning) ? options.reasoning : undefined,
    promptCacheKey: stringOption(options, "promptCacheKey") ?? stringOption(options, "prompt_cache_key"),
  }).filter((entry) => entry[1] !== undefined))
  return mergeProviderOptions(
    configured,
    Object.keys(openrouter).length === 0 ? undefined : { openrouter },
  )
}

const baseURL = (input: Input, options: Record<string, unknown>, fallback?: string) => {
  const configured = stringOption(options, "baseURL") ?? input.model.api.url
  if (configured) return configured
  return fallback
}

const apiKey = (input: Input, options: Record<string, unknown>) => stringOption(options, "apiKey") ?? input.provider.key

const headers = (input: Input, options: Record<string, unknown>) => {
  if (!isRecord(options.headers)) {
    if (Object.keys(input.model.headers).length === 0) return undefined
    return input.model.headers
  }
  const result = { ...recordOption(options, "headers"), ...input.model.headers }
  return Object.keys(result).length === 0 ? undefined : result
}

const sharedOptions = (input: Input, options: Record<string, unknown>, extra: {
  readonly baseURL?: string
  readonly providerOptions?: ProviderOptions
}) => ({
  baseURL: extra.baseURL ?? baseURL(input, options),
  apiKey: apiKey(input, options),
  headers: headers(input, options),
  providerOptions: extra.providerOptions ?? configuredProviderOptions(options),
  limits: LLM.limits({ context: input.model.limit.context, output: input.model.limit.output }),
})

type ProviderModel = (input: Input, options: Record<string, unknown>) => ModelRef | undefined

const openAICompatibleModel: ProviderModel = (input, options) => {
  const provider = String(input.model.providerID)
  const profile = OpenAICompatibleProfiles.byProvider[provider]
  const resolvedBaseURL = baseURL(input, options, profile?.baseURL)
  if (!resolvedBaseURL) return undefined
  const modelOptions = sharedOptions(input, options, {
    baseURL: resolvedBaseURL,
  })
  if (profile) return OpenAICompatible.profileModel(profile, String(input.model.api.id), modelOptions)
  return OpenAICompatible.model(String(input.model.api.id), { ...modelOptions, provider, baseURL: resolvedBaseURL })
}

const PROVIDERS: Record<string, ProviderModel> = {
  "@ai-sdk/amazon-bedrock": (input, options) =>
    AmazonBedrock.model(String(input.model.api.id), sharedOptions(input, options, {})),
  "@ai-sdk/anthropic": (input, options) =>
    Anthropic.model(String(input.model.api.id), sharedOptions(input, options, {})),
  "@ai-sdk/azure": (input, options) => {
    const create = options.useCompletionUrls === true ? Azure.chat : Azure.responses
    // Azure requires at least one of `resourceName` or `baseURL`. The user's
    // config supplies one of them via opencode's provider settings; if neither
    // is set we let Azure's runtime check surface a clear error.
    return create(String(input.model.api.id), {
      ...sharedOptions(input, options, { providerOptions: openAIOptions(options) }),
      resourceName: stringOption(options, "resourceName"),
      apiVersion: stringOption(options, "apiVersion"),
    } as Azure.ModelOptions)
  },
  "@ai-sdk/baseten": openAICompatibleModel,
  "@ai-sdk/cerebras": openAICompatibleModel,
  "@ai-sdk/deepinfra": openAICompatibleModel,
  "@ai-sdk/fireworks": openAICompatibleModel,
  "@ai-sdk/github-copilot": (input, options) =>
    // GitHub Copilot has no canonical public URL; the user's opencode config
    // is expected to supply `baseURL`. Runtime check kicks in if it's missing.
    GitHubCopilot.model(
      String(input.model.api.id),
      {
        ...sharedOptions(input, options, {
          providerOptions: openAIOptions(options),
        }),
      } as GitHubCopilot.ModelOptions,
    ),
  "@ai-sdk/google": (input, options) =>
    Google.model(String(input.model.api.id), sharedOptions(input, options, {})),
  "@ai-sdk/openai": (input, options) =>
    OpenAI.model(String(input.model.api.id), {
      ...sharedOptions(input, options, { providerOptions: openAIOptions(options) }),
    }),
  "@ai-sdk/openai-compatible": openAICompatibleModel,
  "@openrouter/ai-sdk-provider": (input, options) =>
    OpenRouter.model(String(input.model.api.id), {
      ...sharedOptions(input, options, {
        baseURL: baseURL(input, options, OpenRouter.profile.baseURL),
        providerOptions: openRouterOptions(options),
      }),
    }),
  "@ai-sdk/togetherai": openAICompatibleModel,
  "@ai-sdk/xai": (input, options) =>
    XAI.responses(String(input.model.api.id), sharedOptions(input, options, {})),
}

export const toModelRef = (input: Input): ModelRef | undefined => {
  const options = { ...input.provider.options, ...input.model.options }
  return PROVIDERS[input.model.api.npm]?.(input, options)
}

export * as ProviderLLMBridge from "./llm-bridge"
