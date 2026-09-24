import { Context } from "effect"
import { MediaClient } from "./media-client.js"
import {
  ImageOutputEvent,
  ImageFinishEvent,
  type ImageEvent,
  type ImageRequestFor,
  type ImageResponse,
} from "./image.js"

export type Interface = MediaClient.Interface<ImageRequestFor, ImageEvent, ImageResponse>

export class ImageClientService extends Context.Service<ImageClientService, Interface>()("@opencode/ImageClient") {}
export const Service = ImageClientService
export type Service = ImageClientService

export const ImageClient = {
  Service,
  ...MediaClient.make(Service, {
    modality: "image",
    responseEvents: (response: ImageResponse) => [
      ...response.images.map((image, index) => ImageOutputEvent.make({ index, image })),
      ImageFinishEvent.make({
        usage: response.usage,
        notices: response.notices,
        providerMetadata: response.providerMetadata,
      }),
    ],
  }),
} as const
