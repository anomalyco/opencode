import { ProviderResolver } from "../provider-resolver"
import { OpenAIChat, type OpenAIChatModelInput } from "./openai-chat"
import { OpenAIResponses, type OpenAIResponsesModelInput } from "./openai-responses"

export const resolver = ProviderResolver.fixed("openai", "openai-responses")

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

export const responses = (id: string, options: Omit<OpenAIResponsesModelInput, "id"> = {}) =>
  OpenAIResponses.model({ ...options, id })

export const chat = (id: string, options: Omit<OpenAIChatModelInput, "id"> = {}) =>
  OpenAIChat.model({ ...options, id })

export const model = responses

export * as OpenAI from "./openai"
