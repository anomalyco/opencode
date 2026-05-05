import { Adapter, type AdapterRoutedModelInput } from "../adapter"
import { Endpoint } from "../endpoint"
import { Framing } from "../framing"
import { capabilities } from "../llm"
import { OpenAIChat } from "./openai-chat"
import { profiles, type OpenAICompatibleProfile } from "../providers/openai-compatible-profile"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<AdapterRoutedModelInput, "baseURL"> & {
  readonly baseURL: string
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

export const model = Adapter.model<OpenAICompatibleChatModelInput>(adapter, {
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
})

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

export const groq = (input: ProviderFamilyModelInput) => profileModel(profiles.groq, input)

export const openrouter = (input: ProviderFamilyModelInput) => profileModel(profiles.openrouter, input)

export const togetherai = (input: ProviderFamilyModelInput) => profileModel(profiles.togetherai, input)

export const xai = (input: ProviderFamilyModelInput) => profileModel(profiles.xai, input)

export const includeUsage = adapter.patch("include-usage", {
  reason: "request final usage chunk from OpenAI-compatible Chat streaming responses",
  apply: (payload) => ({
    ...payload,
    stream_options: { ...payload.stream_options, include_usage: true },
  }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
