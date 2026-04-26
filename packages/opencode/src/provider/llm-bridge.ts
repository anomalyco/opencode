import * as LLM from "@opencode-ai/llm/llm"
import { AmazonBedrock } from "@opencode-ai/llm/provider/amazon-bedrock"
import { Anthropic } from "@opencode-ai/llm/provider/anthropic"
import { Azure } from "@opencode-ai/llm/provider/azure"
import { GitHubCopilot } from "@opencode-ai/llm/provider/github-copilot"
import { Google } from "@opencode-ai/llm/provider/google"
import { OpenAI } from "@opencode-ai/llm/provider/openai"
import { OpenAICompatibleFamily } from "@opencode-ai/llm/provider/openai-compatible-family"
import { XAI } from "@opencode-ai/llm/provider/xai"
import { ProviderRoute } from "@opencode-ai/llm/provider-route"
import type { ProviderDefinition, ProviderRoute as ProviderRouteType } from "@opencode-ai/llm/provider-route"
import { ReasoningEfforts, type ModelRef, type Protocol, type ReasoningEffort } from "@opencode-ai/llm/schema"
import { isRecord } from "@/util/record"
import type * as Provider from "./provider"

type Input = {
  readonly provider: Provider.Info
  readonly model: Provider.Model
}

const PROVIDERS: Record<string, ProviderDefinition> = {
  "@ai-sdk/amazon-bedrock": AmazonBedrock.provider,
  "@ai-sdk/anthropic": Anthropic.provider,
  "@ai-sdk/azure": Azure.provider,
  "@ai-sdk/baseten": OpenAICompatibleFamily.provider,
  "@ai-sdk/cerebras": OpenAICompatibleFamily.provider,
  "@ai-sdk/deepinfra": OpenAICompatibleFamily.provider,
  "@ai-sdk/fireworks": OpenAICompatibleFamily.provider,
  "@ai-sdk/github-copilot": GitHubCopilot.provider,
  "@ai-sdk/google": Google.provider,
  "@ai-sdk/openai": OpenAI.provider,
  "@ai-sdk/openai-compatible": OpenAICompatibleFamily.provider,
  "@ai-sdk/togetherai": OpenAICompatibleFamily.provider,
  "@ai-sdk/xai": XAI.provider,
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

export const route = (
  input: Input,
  options: Record<string, unknown> = { ...input.provider.options, ...input.model.options },
): ProviderRouteType | undefined =>
  PROVIDERS[input.model.api.npm]?.route(ProviderRoute.input(input.model.api.id, input.model.providerID, options))

const baseURL = (input: Input, selected: Protocol, options: Record<string, unknown>) => {
  const configured = stringOption(options, "baseURL") ?? input.model.api.url
  if (configured) return configured
  if (selected === "openai-compatible-chat") return OpenAICompatibleFamily.byProvider[input.model.providerID]?.baseURL
  return undefined
}

const authHeader = (selected: Protocol, apiKey: string | undefined): Record<string, string> => {
  if (!apiKey) return {}
  if (selected === "anthropic-messages") return { "x-api-key": apiKey }
  if (selected === "gemini") return { "x-goog-api-key": apiKey }
  return { authorization: `Bearer ${apiKey}` }
}

const headers = (input: Input, selected: Protocol, options: Record<string, unknown>) => {
  const result = {
    ...authHeader(selected, stringOption(options, "apiKey") ?? input.provider.key),
    ...recordOption(options, "headers"),
    ...input.model.headers,
  }
  return Object.keys(result).length === 0 ? undefined : result
}

const reasoningEfforts = (input: Input) =>
  Object.keys(input.model.variants ?? {}).filter((effort): effort is ReasoningEffort =>
    REASONING_EFFORTS.has(effort as ReasoningEffort),
  )

const capabilities = (input: Input, selected: Protocol) =>
  LLM.capabilities({
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
      streamingInput: selected !== "gemini" && input.model.capabilities.toolcall,
    },
    cache: {
      prompt: ["anthropic-messages", "bedrock-converse"].includes(selected),
      contentBlocks: selected === "anthropic-messages",
    },
    reasoning: {
      efforts: reasoningEfforts(input),
      summaries: selected === "openai-responses",
      encryptedContent: selected === "openai-responses" || selected === "anthropic-messages",
    },
  })

export const toModelRef = (input: Input): ModelRef | undefined => {
  const options = { ...input.provider.options, ...input.model.options }
  const selected = route(input, options)
  if (!selected) return undefined
  return LLM.model({
    id: input.model.api.id,
    provider: selected.provider,
    protocol: selected.protocol,
    baseURL: baseURL(input, selected.protocol, options),
    headers: headers(input, selected.protocol, options),
    capabilities: capabilities(input, selected.protocol),
    limits: LLM.limits({ context: input.model.limit.context, output: input.model.limit.output }),
    native: {
      opencodeProviderID: input.provider.id,
      opencodeModelID: input.model.id,
      npm: input.model.api.npm,
      options,
    },
  })
}

export * as ProviderLLMBridge from "./llm-bridge"
