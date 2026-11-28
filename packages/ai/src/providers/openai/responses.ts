import { OpenAIResponses } from "../../protocols/openai-responses.js"
import { Provider } from "../../provider.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"
import { options, shared, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const responses = OpenAIResponses.api.configure({ options })

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput, typeof responses.compact>(
  Provider.make({ ...shared, apis: [responses] }),
)
