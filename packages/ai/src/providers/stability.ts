import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { DEFAULT_BASE_URL, StabilityImages } from "../protocols/stability-images.js"

export type { StabilityImageOptions, StabilityUpscaleOptions } from "../protocols/stability-images.js"

export const id = ProviderID.make("stability")
const baseURL = DEFAULT_BASE_URL

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "STABILITY_API_KEY")

export const configure = (input: Config = {}) => {
  const deployment = {
    auth: auth(input),
    baseURL: input.baseURL ?? baseURL,
    headers: input.headers,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  }
  return {
    id,
    image: (modelID: string | ModelID) => StabilityImages.model({ ...deployment, id: modelID }),
    upscale: () => StabilityImages.upscaleModel(deployment),
    configure,
  }
}

export const provider = configure()
export const image = provider.image
export const upscale = provider.upscale
