import { Adapter } from "../adapter"
import { Endpoint } from "../endpoint"
import { Framing } from "../framing"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import { OpenAIChat } from "./openai-chat"
import { profiles, type OpenAICompatibleProfile } from "./openai-compatible-profile"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<ModelInput, "protocol" | "headers" | "baseURL"> & {
  readonly baseURL: string
  readonly apiKey?: string
  readonly headers?: Record<string, string>
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
export const adapter = Adapter.make({
  id: ADAPTER,
  protocol: OpenAIChat.protocol,
  protocolId: "openai-compatible-chat",
  endpoint: Endpoint.baseURL({
    path: "/chat/completions",
    required: "OpenAI-compatible Chat requires a baseURL",
  }),
  framing: Framing.sse,
})

export const model = (input: OpenAICompatibleChatModelInput) =>
  Adapter.bindModel(
    llmModel({
      ...input,
      protocol: "openai-compatible-chat",
      capabilities: input.capabilities ?? capabilities({ tools: { calls: true, streamingInput: true } }),
    }),
    adapter,
  )

const profileBaseURL = (profile: OpenAICompatibleProfile, input: ProviderFamilyModelInput) => {
  const baseURL = input.baseURL ?? profile.baseURL
  if (baseURL) return baseURL
  throw new Error(`OpenAI-compatible profile ${profile.provider} requires a baseURL`)
}

export const profileModel = (profile: OpenAICompatibleProfile, input: ProviderFamilyModelInput) =>
  model({
    ...input,
    provider: profile.provider,
    baseURL: profileBaseURL(profile, input),
    capabilities: input.capabilities ?? profile.capabilities,
  })

export const baseten = (input: ProviderFamilyModelInput) => profileModel(profiles.baseten, input)

export const cerebras = (input: ProviderFamilyModelInput) => profileModel(profiles.cerebras, input)

export const deepinfra = (input: ProviderFamilyModelInput) => profileModel(profiles.deepinfra, input)

export const deepseek = (input: ProviderFamilyModelInput) => profileModel(profiles.deepseek, input)

export const fireworks = (input: ProviderFamilyModelInput) => profileModel(profiles.fireworks, input)

export const togetherai = (input: ProviderFamilyModelInput) => profileModel(profiles.togetherai, input)

export const includeUsage = adapter.patch("include-usage", {
  reason: "request final usage chunk from OpenAI-compatible Chat streaming responses",
  apply: (target) => ({
    ...target,
    stream_options: { ...target.stream_options, include_usage: true },
  }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
