import { Effect } from "effect"

export interface MediaPart {
  readonly type: "image" | "video" | "audio" | "document"
  readonly data: Uint8Array
  readonly filename?: string
  readonly mimeType?: string
  readonly ref?: string
}

export interface MediaSender {
  sendMedia(channelId: string, media: MediaPart[]): Effect.Effect<void>
}