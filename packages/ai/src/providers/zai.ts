import { ZAIImages } from "../protocols/zai-images"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { HttpOptions, ProviderID, type ModelID } from "../schema"

export const id = ProviderID.make("zai")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

export type { ZAIImageOptions } from "../protocols/zai-images"

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "ZAI_API_KEY")

export const configure = (input: Config = {}) => {
  const image = (modelID: string | ModelID) =>
    ZAIImages.model({
      id: modelID,
      auth: auth(input),
      baseURL: input.baseURL,
      headers: input.headers,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    })

  return {
    id,
    image,
    configure,
  }
}

export const provider = configure()
export const image = provider.image
