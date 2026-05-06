import * as OpenAIChat from "../protocols/openai-chat"
import type { OpenAIChatModelInput } from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import type { OpenAIResponsesModelInput } from "../protocols/openai-responses"
import { withOpenAIPolicy, type OpenAIOptionsInput } from "./openai-policy"

export type { OpenAIOptionsInput } from "./openai-policy"

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

type OpenAIModelInput<ModelInput> = ModelInput & {
  readonly openai?: OpenAIOptionsInput
}

export const responses = (id: string, options: OpenAIModelInput<Omit<OpenAIResponsesModelInput, "id">> = {}) => {
  return OpenAIResponses.model(withOpenAIPolicy(id, options, { textVerbosity: true }))
}

export const chat = (id: string, options: OpenAIModelInput<Omit<OpenAIChatModelInput, "id">> = {}) => {
  return OpenAIChat.model(withOpenAIPolicy(id, options))
}

export const model = responses
