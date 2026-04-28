import { Adapter } from "../adapter"
import { Auth } from "../auth"
import { Endpoint } from "../endpoint"
import { Framing } from "../framing"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import { OpenAIChat } from "./openai-chat"
import { families, type ProviderFamily } from "./openai-compatible-family"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<ModelInput, "protocol" | "headers" | "baseURL"> & {
  readonly baseURL: string
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly queryParams?: Record<string, string>
}

export type ProviderFamilyModelInput = Omit<OpenAICompatibleChatModelInput, "provider" | "baseURL"> & {
  readonly baseURL?: string
}

/**
 * Adapter for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses `OpenAIChat.protocol` end-to-end and
 * only overrides:
 *
 * - the registered protocol id (`openai-compatible-chat`) so providers can be
 *   resolved per-family without colliding with native OpenAI;
 * - the endpoint, which requires `model.baseURL` (no provider default).
 */
export const adapter = Adapter.fromProtocol({
  id: ADAPTER,
  protocol: OpenAIChat.protocol,
  protocolId: "openai-compatible-chat",
  endpoint: Endpoint.baseURL({
    path: "/chat/completions",
    required: "OpenAI-compatible Chat requires a baseURL",
  }),
  auth: Auth.bearer,
  framing: Framing.sse,
})

export const model = (input: OpenAICompatibleChatModelInput) => {
  const { queryParams, native, ...rest } = input
  return llmModel({
    ...rest,
    protocol: "openai-compatible-chat",
    native: queryParams ? { ...native, queryParams } : native,
    capabilities: input.capabilities ?? capabilities({ tools: { calls: true, streamingInput: true } }),
  })
}

const familyModel = (family: ProviderFamily, input: ProviderFamilyModelInput) =>
  model({
    ...input,
    provider: family.provider,
    baseURL: input.baseURL ?? family.baseURL,
    native: { ...input.native, openaiCompatibleProvider: family.provider },
  })

export const baseten = (input: ProviderFamilyModelInput) => familyModel(families.baseten, input)

export const cerebras = (input: ProviderFamilyModelInput) => familyModel(families.cerebras, input)

export const deepinfra = (input: ProviderFamilyModelInput) => familyModel(families.deepinfra, input)

export const deepseek = (input: ProviderFamilyModelInput) => familyModel(families.deepseek, input)

export const fireworks = (input: ProviderFamilyModelInput) => familyModel(families.fireworks, input)

export const togetherai = (input: ProviderFamilyModelInput) => familyModel(families.togetherai, input)

export const includeUsage = adapter.patch("include-usage", {
  reason: "request final usage chunk from OpenAI-compatible Chat streaming responses",
  apply: (target) => ({
    ...target,
    stream_options: { ...target.stream_options, include_usage: true },
  }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
