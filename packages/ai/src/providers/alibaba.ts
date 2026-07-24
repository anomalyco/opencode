import { AlibabaImages } from "../protocols/alibaba-images"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { HttpOptions, ProviderID } from "../schema"

export type { AlibabaColor, AlibabaImageOptions } from "../protocols/alibaba-images"

export const id = ProviderID.make("alibaba")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "DASHSCOPE_API_KEY")

export const configure = (input: Config = {}) => {
  const image = (modelID: string) =>
    AlibabaImages.model({
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
