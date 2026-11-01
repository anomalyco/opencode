import type { ProviderPackage } from "../provider-package.js"
import { MistralChat } from "../protocols/mistral-chat.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderID, type ModelID } from "../schema/index.js"

const id = ProviderID.make("mistral")

export type ProviderOptions = MistralChat.ProviderOptionsInput

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptions
  }

export type Settings = ProviderPackage.Settings &
  ProviderOptions & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const route = MistralChat.route
export const routes = [route]

const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, ...defaults } = input
  const configured = route.with({
    ...defaults,
    endpoint: { baseURL: baseURL ?? MistralChat.DEFAULT_BASE_URL },
    auth: AuthOptions.bearer(input, "MISTRAL_API_KEY"),
  })
  return Object.assign((modelID: string | ModelID) => configured.model<ProviderOptions>({ id: modelID }), {
    id,
    configure,
  })
}

export const mistral = configure()

export const model: ProviderPackage.Model<Settings, ProviderOptions> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  })(modelID)
