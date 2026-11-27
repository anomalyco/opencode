import { OpenAICompatibleResponses } from "../../protocols/openai-compatible-responses.js"
import { Provider } from "../../provider.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"
import { shared, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<OpenResponsesProviderOptionsInput>

export const responses = OpenAICompatibleResponses.api

export const model = Provider.entrypoint<Settings, OpenResponsesProviderOptionsInput>(
  Provider.make({ ...shared, apis: [responses] }),
)
