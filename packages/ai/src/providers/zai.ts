import { OpenAIImages, type ZAIImageOptions } from "../protocols/openai-images"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { HttpOptions, ProviderID, type ModelID } from "../schema"

export const id = ProviderID.make("zai")

export interface ImageConfig {
  readonly providerOptions?: ZAIImageOptions
}

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
  readonly image?: ImageConfig
}

export type { ZAIImageOptions } from "../protocols/openai-images"

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "ZAI_API_KEY")

export const configure = (input: Config = {}) => {
  const image = (modelID: string | ModelID) =>
    OpenAIImages.model({
      id: modelID,
      protocol: "zai",
      auth: auth(input),
      baseURL: input.baseURL ?? "https://api.z.ai/api/paas/v4",
      headers: input.headers,
      defaults: {
        providerOptions:
          input.image?.providerOptions === undefined ? undefined : { zai: { ...input.image.providerOptions } },
        http: input.http === undefined ? undefined : HttpOptions.make(input.http),
      },
    })

  return {
    id,
    image,
    configure,
  }
}

export const provider = configure()
export const image = provider.image
