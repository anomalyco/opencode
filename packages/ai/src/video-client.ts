import { Context } from "effect"
import { MediaClient } from "./media-client.js"
import {
  VideoOutputEvent,
  VideoFinishEvent,
  type VideoEvent,
  type VideoRequestFor,
  type VideoResponse,
} from "./video.js"

export type Interface = MediaClient.Interface<VideoRequestFor, VideoEvent, VideoResponse>

export class VideoClientService extends Context.Service<VideoClientService, Interface>()("@opencode/VideoClient") {}
export const Service = VideoClientService
export type Service = VideoClientService

export const VideoClient = {
  Service,
  ...MediaClient.make(Service, {
    modality: "video",
    responseEvents: (response: VideoResponse) => [
      ...response.videos.map((video, index) => VideoOutputEvent.make({ index, video })),
      VideoFinishEvent.make({
        usage: response.usage,
        notices: response.notices,
        providerMetadata: response.providerMetadata,
      }),
    ],
  }),
} as const
