import type { ProviderPackage } from "../provider-package.js"
import { OpenAICompatibleResponses } from "../protocols/openai-compatible-responses.js"
import { Provider } from "../provider.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export type { OpenResponsesOptionsInput, OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export type Settings = ProviderPackage.Settings &
  OpenResponsesProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL: string
    /** Provider id the model reports. Defaults to `openai-compatible`. */
    readonly provider?: string
  }

/** A server at `baseURL` speaking Open Responses. Keys are sent as `Authorization: Bearer` when given. */
export const openAICompatibleResponses = (id = "openai-compatible") =>
  Provider.make({ id, auth: Provider.apiKey([]), apis: [OpenAICompatibleResponses.api] })

export const model: ProviderPackage.Model<Settings, OpenResponsesProviderOptionsInput> = (
  modelID,
  { provider, ...settings },
) =>
  Provider.entrypoint<Settings, OpenResponsesProviderOptionsInput>(openAICompatibleResponses(provider))(
    modelID,
    settings,
  )
