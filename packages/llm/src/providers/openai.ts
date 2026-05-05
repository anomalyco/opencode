import * as OpenAIChat from "../protocols/openai-chat"
import type { OpenAIChatModelInput } from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import type { OpenAIResponsesModelInput } from "../protocols/openai-responses"

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

export const responses = (id: string, options: Omit<OpenAIResponsesModelInput, "id"> = {}) =>
  OpenAIResponses.model({ ...options, id })

export const chat = (id: string, options: Omit<OpenAIChatModelInput, "id"> = {}) =>
  OpenAIChat.model({ ...options, id })

export const model = responses
