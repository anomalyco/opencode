import type { ProviderPackage } from "../provider-package"
import { OpenAICompatibleResponses } from "../protocols/openai-compatible-responses"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID } from "../schema"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options"

export type { OpenResponsesOptionsInput, OpenResponsesProviderOptionsInput } from "./open-responses-options"

export const id = ProviderID.make("openai-compatible")

export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL: string
    readonly providerOptions?: OpenResponsesProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL: string
  readonly provider?: string
  readonly providerOptions?: OpenResponsesProviderOptionsInput
}

export const routes = [OpenAICompatibleResponses.route]

export const configure = (input: Config) => {
  const provider = input.provider ?? "openai-compatible"
  const { provider: _, baseURL, apiKey: _apiKey, auth: _auth, ...rest } = input
  const route = OpenAICompatibleResponses.route.with({
    ...rest,
    provider,
    endpoint: { baseURL },
    auth: AuthOptions.bearer(input, []),
  })
  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    provider: settings.provider,
    providerOptions: settings.providerOptions,
  }).model(modelID)
