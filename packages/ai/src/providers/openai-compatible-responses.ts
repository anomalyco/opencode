import type { ProviderPackage } from "../provider-package.js"
import { OpenAICompatibleResponses } from "../protocols/openai-compatible-responses.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export type { OpenResponsesOptionsInput, OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

const id = ProviderID.make("openai-compatible")

export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL: string
    readonly providerOptions?: OpenResponsesProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenResponsesProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL: string
    readonly provider?: string
  }

export const routes = [OpenAICompatibleResponses.route]

const configure = (input: Config) => {
  const provider = input.provider ?? "openai-compatible"
  const { provider: _, baseURL, apiKey: _apiKey, auth: _auth, ...rest } = input
  const route = OpenAICompatibleResponses.route.with({
    ...rest,
    provider,
    endpoint: { baseURL },
    auth: AuthOptions.bearer(input, []),
  })
  return Object.assign((modelID: string | ModelID) => route.model<OpenResponsesProviderOptionsInput>({ id: modelID }), {
    id: ProviderID.make(provider),
    configure,
  })
}

export const openaiCompatibleResponses = Object.assign(
  (modelID: string | ModelID, input: Config) => configure(input)(modelID),
  { id, configure },
)

export const model: ProviderPackage.Model<Settings, OpenResponsesProviderOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, provider, ...providerOptions },
) =>
  configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    provider,
    providerOptions,
  })(modelID)
