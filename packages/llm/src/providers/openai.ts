import * as OpenAIChat from "../protocols/openai-chat"
import type { OpenAIChatModelInput } from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import type { OpenAIResponsesModelInput } from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export type { OpenAIOptionsInput } from "./openai-options"

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

type OpenAIModelInput<ModelInput> = ModelInput & {
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export const responses = (id: string, options: OpenAIModelInput<Omit<OpenAIResponsesModelInput, "id">> = {}) => {
  return OpenAIResponses.model(withOpenAIOptions(id, options, { textVerbosity: true }))
}

export const chat = (id: string, options: OpenAIModelInput<Omit<OpenAIChatModelInput, "id">> = {}) => {
  return OpenAIChat.model(withOpenAIOptions(id, options))
}

export const model = responses
