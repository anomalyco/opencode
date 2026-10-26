import { ProviderID, type ModelID } from "../schema/index.js"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { SystemOne } from "../protocols/system-one.js"
import { MediaRoute } from "../route/media.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("openai-compatible")

type GenericModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
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

export const configure = (input: GenericModelOptions) => {
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
  const decisionRoute = SystemOne.route.with({
    provider,
    endpoint: { baseURL },
    auth,
    // System One hosts serve TypeSafe's models, which need this header for images; text-only requests are unchanged.
    headers: { "TypeSafe-Danger-Zone-Images": "true", ...input.headers },
    http: input.http,
  })
  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) => route.model<OpenAIProviderOptionsInput>({ id: modelID }),
    image: (modelID: string | ModelID) => OpenAIImages.model({ ...media, id: modelID, provider }),
    decision: (modelID: string | ModelID) => decisionRoute.model({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (modelID, settings) =>
  fromSettings(settings).model(modelID)
export const imageModel = (modelID: string, settings: Settings) => fromSettings(settings).image(modelID)
export const decisionModel = (modelID: string, settings: Settings) => fromSettings(settings).decision(modelID)

function fromSettings({ apiKey, baseURL, body, headers, provider, ...providerOptions }: Settings) {
  return configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    provider,
    providerOptions,
  })
}

export * as OpenAICompatible from "./openai-compatible.js"
