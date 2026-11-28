import {
  mergeTransport,
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
import { Provider } from "../provider.js"
import { MediaRoute } from "../route/media.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { toConfig } from "./settings.js"

/** Connection settings for media models on an OpenAI-compatible host. Language models come from `openAICompatible`. */
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

/** An OpenAI Chat host. Pass `baseURL` with `with`; `id` names the provider and its metadata namespace. */
export const make = (id = "openai-compatible") =>
  Provider.make({ id, auth: Provider.apiKey([]), apis: [OpenAICompatibleChat.api] })

export const openAICompatible = make()

export const media = (input: Config) => {
  const provider = input.provider ?? "openai-compatible"
  const auth = AuthOptions.bearer(input, [])
  const media = MediaRoute.deployment(input, auth)
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider,
    endpoint: { baseURL: input.baseURL },
    auth,
    ...mergeTransport(input),
  })
  const decisionRoute = SystemOne.route.with({
    provider,
    endpoint: { baseURL: input.baseURL },
    auth,
    ...mergeTransport(input),
  })
  return {
    id: ProviderID.make(provider),
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
  }
}

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (
  modelID,
  { provider, ...settings },
) => Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(make(provider))(modelID, settings)
export const imageModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return media(input).embedding(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return media(input).decision(modelID, input.providerOptions)
}

function config({ provider, ...settings }: Settings) {
  return { ...toConfig(settings), provider }
}

export * as OpenAICompatible from "./openai-compatible.js"
