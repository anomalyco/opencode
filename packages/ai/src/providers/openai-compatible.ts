import {
  mergeProviderOptions,
  ProviderID,
  type ModelID,
  type ProviderOptions,
  type RequestOptions,
} from "../schema/index.js"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat.js"
import { OpenAIEmbeddings, type OptionsInput as OpenAIEmbeddingOptionsInput } from "../protocols/openai-embeddings.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { SystemOne } from "../protocols/system-one.js"
import { MediaRoute } from "../route/media.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { toConfig } from "./settings.js"

export const id = ProviderID.make("openai-compatible")

export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
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
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider,
    endpoint: { baseURL },
    auth,
    headers: input.headers,
    http: input.http,
  })
  const decisionRoute = SystemOne.route.with({
    provider,
    endpoint: { baseURL },
    auth,
    headers: input.headers,
    http: input.http,
  })
  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) => route.model<OpenAIProviderOptionsInput>({ id: modelID }),
    // Many compatible hosts default to hosted URLs. GPT Image models always return bytes and reject the field; a
    // proxy serving one under another name can drop the default with `response_format: null`.
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      OpenAIImages.model({
        ...media,
        id: modelID,
        provider,
        providerOptions: mergeProviderOptions(
          /gpt-image|chatgpt-image/.test(modelID) ? undefined : { response_format: "b64_json" },
          providerOptions,
        ),
      }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model<OpenAIEmbeddingOptionsInput>({ id: modelID, providerOptions }),
    // Compatible hosts follow llama.cpp's System One API, which takes inline media in root `images` (alias of `files`).
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      decisionRoute.model({ id: modelID, compatibility: { mediaInput: "root" }, providerOptions }),
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
export const embeddingModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return configure(input).embedding(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

function config({ provider, ...settings }: Settings) {
  return { ...toConfig(settings), provider }
}

export * as OpenAICompatible from "./openai-compatible.js"
