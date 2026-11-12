import { Context } from "effect"
import { MediaClient } from "./media-client.js"
import type { ImageEvent, ImageRequest, ImageResponse } from "./image.js"

export type Interface = MediaClient.Interface<ImageRequest, ImageEvent, ImageResponse>

export class ImageClientService extends Context.Service<ImageClientService, Interface>()("@opencode/ImageClient") {}
export const Service = ImageClientService
export type Service = ImageClientService

export const ImageClient = {
  Service,
  ...MediaClient.make(Service, {
    modality: "image",
    responseEvents: (response: ImageResponse) => [
      ...response.images.map((image, index) => ({ type: "image" as const, index, image })),
      { type: "finish" as const, usage: response.usage, providerMetadata: response.providerMetadata },
    ],
  }),
} as const
