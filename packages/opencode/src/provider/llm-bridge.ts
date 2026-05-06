import {
  LLM,
  ReasoningEffort as ReasoningEffortSchema,
  TextVerbosity as TextVerbositySchema,
  mergeProviderOptions,
  type CapabilitiesInput,
  type ModelRef,
  type ProviderOptions,
  type ProtocolID,
} from "@opencode-ai/llm"
import { AmazonBedrock, Anthropic, Azure, GitHubCopilot, Google, OpenAI, OpenAICompatible, XAI } from "@opencode-ai/llm/providers"
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

const reasoningEfforts = (input: Input) =>
  Object.keys(input.model.variants ?? {}).flatMap((effort) => {
    const decoded = Option.getOrUndefined(decodeReasoningEffort(effort))
    return decoded ? [decoded] : []
  })

const mergeCapabilities = (base: CapabilitiesInput, override: CapabilitiesInput): CapabilitiesInput => ({
  input: { ...base.input, ...override?.input },
  output: { ...base.output, ...override?.output },
  tools: { ...base.tools, ...override?.tools },
  cache: { ...base.cache, ...override?.cache },
  reasoning: { ...base.reasoning, ...override?.reasoning },
})

const capabilities = (input: Input, protocol: ProtocolID, override?: CapabilitiesInput) => {
  const base: CapabilitiesInput = {
    input: {
      text: input.model.capabilities.input.text,
      image: input.model.capabilities.input.image,
      audio: input.model.capabilities.input.audio,
      video: input.model.capabilities.input.video,
      pdf: input.model.capabilities.input.pdf,
    },
    output: {
      text: input.model.capabilities.output.text,
      reasoning: input.model.capabilities.reasoning,
    },
    tools: {
      calls: input.model.capabilities.toolcall,
      streamingInput: protocol !== "gemini" && input.model.capabilities.toolcall,
    },
    cache: {
      // Both Anthropic Messages and Bedrock Converse honour positional cache
      // markers — Anthropic via `cache_control` on content blocks, Bedrock via
      // its `cachePoint` marker block (added to BedrockConverse in 9d7d518ac).
      prompt: ["anthropic-messages", "bedrock-converse"].includes(protocol),
      contentBlocks: ["anthropic-messages", "bedrock-converse"].includes(protocol),
    },
    reasoning: {
      efforts: reasoningEfforts(input),
      summaries: protocol === "openai-responses",
      encryptedContent: protocol === "openai-responses" || protocol === "anthropic-messages",
    },
  }
  return LLM.capabilities(override ? mergeCapabilities(base, override) : base)
}

const sharedOptions = (input: Input, options: Record<string, unknown>, extra: {
  readonly protocol: ProtocolID
  readonly baseURL?: string
  readonly capabilities?: CapabilitiesInput
  readonly providerOptions?: ProviderOptions
}) => ({
  baseURL: extra.baseURL ?? baseURL(input, options),
  apiKey: apiKey(input, options),
  headers: headers(input, options),
  providerOptions: extra.providerOptions ?? configuredProviderOptions(options),
  capabilities: capabilities(input, extra.protocol, extra.capabilities),
  limits: LLM.limits({ context: input.model.limit.context, output: input.model.limit.output }),
})

type ProviderModel = (input: Input, options: Record<string, unknown>) => ModelRef | undefined

const azureProtocol = (options: Record<string, unknown>): ProtocolID =>
  options.useCompletionUrls === true ? "openai-chat" : "openai-responses"

const openAICompatibleModel: ProviderModel = (input, options) => {
  const provider = String(input.model.providerID)
  const profile = OpenAICompatibleProfiles.byProvider[provider]
  const resolvedBaseURL = baseURL(input, options, profile?.baseURL)
  if (!resolvedBaseURL) return undefined
  const modelOptions = sharedOptions(input, options, {
    protocol: "openai-chat",
    baseURL: resolvedBaseURL,
    capabilities: profile?.capabilities,
  })
  if (profile) return OpenAICompatible.profileModel(profile, String(input.model.api.id), modelOptions)
  return OpenAICompatible.model(String(input.model.api.id), { ...modelOptions, provider, baseURL: resolvedBaseURL })
}

const PROVIDERS: Record<string, ProviderModel> = {
  "@ai-sdk/amazon-bedrock": (input, options) =>
    AmazonBedrock.model(String(input.model.api.id), sharedOptions(input, options, { protocol: "bedrock-converse" })),
  "@ai-sdk/anthropic": (input, options) =>
    Anthropic.model(String(input.model.api.id), sharedOptions(input, options, { protocol: "anthropic-messages" })),
  "@ai-sdk/azure": (input, options) =>
    Azure.model(String(input.model.api.id), {
      ...sharedOptions(input, options, { protocol: azureProtocol(options), providerOptions: openAIOptions(options) }),
      resourceName: stringOption(options, "resourceName"),
      apiVersion: stringOption(options, "apiVersion"),
      useCompletionUrls: options.useCompletionUrls === true,
    }),
  "@ai-sdk/baseten": openAICompatibleModel,
  "@ai-sdk/cerebras": openAICompatibleModel,
  "@ai-sdk/deepinfra": openAICompatibleModel,
  "@ai-sdk/fireworks": openAICompatibleModel,
  "@ai-sdk/github-copilot": (input, options) =>
    GitHubCopilot.model(
      String(input.model.api.id),
      {
        ...sharedOptions(input, options, {
          protocol: GitHubCopilot.shouldUseResponsesApi(String(input.model.api.id)) ? "openai-responses" : "openai-chat",
          providerOptions: openAIOptions(options),
        }),
      },
    ),
  "@ai-sdk/google": (input, options) =>
    Google.model(String(input.model.api.id), sharedOptions(input, options, { protocol: "gemini" })),
  "@ai-sdk/openai": (input, options) =>
    OpenAI.model(String(input.model.api.id), {
      ...sharedOptions(input, options, { protocol: "openai-responses", providerOptions: openAIOptions(options) }),
    }),
  "@ai-sdk/openai-compatible": openAICompatibleModel,
  "@ai-sdk/togetherai": openAICompatibleModel,
  "@ai-sdk/xai": (input, options) =>
    XAI.model(String(input.model.api.id), sharedOptions(input, options, { protocol: "openai-responses" })),
}

export const toModelRef = (input: Input): ModelRef | undefined => {
  const options = { ...input.provider.options, ...input.model.options }
  return PROVIDERS[input.model.api.npm]?.(input, options)
}

export * as ProviderLLMBridge from "./llm-bridge"
