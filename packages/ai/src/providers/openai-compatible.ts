import { ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { MediaRoute } from "../route/media.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("openai-compatible")

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string
    readonly baseURL: string
    readonly provider?: string
  }

export const routes = [OpenAICompatibleChat.route]

export const configure = (input: Config) => {
  const provider = input.provider ?? "openai-compatible"
  const { provider: _, baseURL, apiKey: _apiKey, auth: _auth, ...rest } = input
  const auth = AuthOptions.bearer(input, [])
  const route = OpenAICompatibleChat.route.with({
    ...rest,
    provider,
    endpoint: { baseURL },
    auth,
  })
  const media = MediaRoute.deployment(input, auth)
  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) => route.model<OpenAIProviderOptionsInput>({ id: modelID }),
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      OpenAIImages.model({ ...media, id: modelID, provider, providerOptions }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const imageModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, body, headers, provider, ...providerOptions }: Settings) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    provider,
    providerOptions,
  }
}

export * as OpenAICompatible from "./openai-compatible.js"
