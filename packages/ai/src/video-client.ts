import { Context } from "effect"
import { MediaClient } from "./media-client.js"
import type { VideoEvent, VideoRequest, VideoResponse } from "./video.js"

export type Interface = MediaClient.Interface<VideoRequest, VideoEvent, VideoResponse>

export class VideoClientService extends Context.Service<VideoClientService, Interface>()("@opencode/VideoClient") {}
export const Service = VideoClientService
export type Service = VideoClientService

export const VideoClient = {
  Service,
  ...MediaClient.make(Service, {
    modality: "video",
    responseEvents: (response: VideoResponse) => [
      ...response.videos.map((video, index) => ({ type: "video" as const, index, video })),
      { type: "finish" as const, usage: response.usage, providerMetadata: response.providerMetadata },
    ],
  }),
} as const
