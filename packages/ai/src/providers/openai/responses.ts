import { OpenAIResponses } from "../../protocols/openai-responses.js"
import { Provider } from "../../provider.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"
import { baseURL, guess, shared, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const responsesBinding = OpenAIResponses.api.at(baseURL, { guess })

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput, typeof OpenAIResponses.api.compact>(
  Provider.make({ ...shared, apis: { responses: responsesBinding } }),
)
