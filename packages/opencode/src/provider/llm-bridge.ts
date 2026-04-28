import {
  AmazonBedrock,
  Anthropic,
  GitHubCopilot,
  Google,
  LLM,
  OpenAI,
  OpenAICompatibleFamily,
  ProviderResolver,
  ReasoningEfforts,
  XAI,
  type CapabilitiesInput,
  type ModelRef,
  type ProviderAuth,
  type ProviderResolution,
  type ProviderResolverShape,
  type ReasoningEffort,
} from "@opencode-ai/llm"
import { isRecord } from "@/util/record"
import type * as Provider from "./provider"

type Input = {
  readonly provider: Provider.Info
  readonly model: Provider.Model
}

const PROVIDERS: Record<string, ProviderResolverShape> = {
  "@ai-sdk/amazon-bedrock": AmazonBedrock.resolver,
  "@ai-sdk/anthropic": Anthropic.resolver,
  "@ai-sdk/baseten": OpenAICompatibleFamily.resolver,
  "@ai-sdk/cerebras": OpenAICompatibleFamily.resolver,
  "@ai-sdk/deepinfra": OpenAICompatibleFamily.resolver,
  "@ai-sdk/fireworks": OpenAICompatibleFamily.resolver,
  "@ai-sdk/github-copilot": GitHubCopilot.resolver,
  "@ai-sdk/google": Google.resolver,
  "@ai-sdk/openai": OpenAI.resolver,
  "@ai-sdk/openai-compatible": OpenAICompatibleFamily.resolver,
  "@ai-sdk/togetherai": OpenAICompatibleFamily.resolver,
  "@ai-sdk/xai": XAI.resolver,
}

const REASONING_EFFORTS = new Set<ReasoningEffort>(ReasoningEfforts)

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

export const resolve = (
  input: Input,
  options: Record<string, unknown> = { ...input.provider.options, ...input.model.options },
): ProviderResolution | undefined =>
  PROVIDERS[input.model.api.npm]?.resolve(ProviderResolver.input(input.model.api.id, input.model.providerID, options))

const baseURL = (input: Input, resolution: ProviderResolution, options: Record<string, unknown>) => {
  const configured = stringOption(options, "baseURL") ?? input.model.api.url
  if (configured) return configured
  return resolution.baseURL
}

const authHeader = (auth: ProviderAuth | undefined, apiKey: string | undefined): Record<string, string> => {
  if (!apiKey) return {}
  if (auth === "none") return {}
  if (auth === "anthropic-api-key") return { "x-api-key": apiKey }
  if (auth === "google-api-key") return { "x-goog-api-key": apiKey }
  return { authorization: `Bearer ${apiKey}` }
}

const headers = (input: Input, resolution: ProviderResolution, options: Record<string, unknown>) => {
  const result = {
    ...authHeader(resolution.auth, stringOption(options, "apiKey") ?? input.provider.key),
    ...recordOption(options, "headers"),
    ...input.model.headers,
  }
  return Object.keys(result).length === 0 ? undefined : result
}

const reasoningEfforts = (input: Input) =>
  Object.keys(input.model.variants ?? {}).filter((effort): effort is ReasoningEffort =>
    REASONING_EFFORTS.has(effort as ReasoningEffort),
  )

const mergeCapabilities = (base: CapabilitiesInput, override: CapabilitiesInput | undefined): CapabilitiesInput => ({
  input: { ...base.input, ...override?.input },
  output: { ...base.output, ...override?.output },
  tools: { ...base.tools, ...override?.tools },
  cache: { ...base.cache, ...override?.cache },
  reasoning: { ...base.reasoning, ...override?.reasoning },
})

const capabilities = (input: Input, resolution: ProviderResolution) =>
  LLM.capabilities(
    mergeCapabilities(
      {
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
          streamingInput: resolution.protocol !== "gemini" && input.model.capabilities.toolcall,
        },
        cache: {
          // Both Anthropic Messages and Bedrock Converse honour positional cache
          // markers — Anthropic via `cache_control` on content blocks, Bedrock via
          // its `cachePoint` marker block (added to BedrockConverse in 9d7d518ac).
          prompt: ["anthropic-messages", "bedrock-converse"].includes(resolution.protocol),
          contentBlocks: ["anthropic-messages", "bedrock-converse"].includes(resolution.protocol),
        },
        reasoning: {
          efforts: reasoningEfforts(input),
          summaries: resolution.protocol === "openai-responses",
          encryptedContent: resolution.protocol === "openai-responses" || resolution.protocol === "anthropic-messages",
        },
      },
      resolution.capabilities,
    ),
  )

export const toModelRef = (input: Input): ModelRef | undefined => {
  const options = { ...input.provider.options, ...input.model.options }
  const resolution = resolve(input, options)
  if (!resolution) return undefined
  return LLM.model({
    id: input.model.api.id,
    provider: resolution.provider,
    protocol: resolution.protocol,
    baseURL: baseURL(input, resolution, options),
    headers: headers(input, resolution, options),
    capabilities: capabilities(input, resolution),
    limits: LLM.limits({ context: input.model.limit.context, output: input.model.limit.output }),
    native: {
      opencodeProviderID: input.provider.id,
      opencodeModelID: input.model.id,
      npm: input.model.api.npm,
    },
  })
}

export * as ProviderLLMBridge from "./llm-bridge"
