import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { StabilityImages } from "../protocols/stability-images.js"

export type { StabilityImageOptions, StabilityUpscaleOptions } from "../protocols/stability-images.js"

export const id = ProviderID.make("stability")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "STABILITY_API_KEY")

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  return {
    id,
    image: (modelID: string | ModelID) => StabilityImages.model({ ...media, id: modelID }),
    upscale: () => StabilityImages.upscaleModel(media),
    configure,
  }
}

export const provider = configure()
export const image = provider.image
export const upscale = provider.upscale
