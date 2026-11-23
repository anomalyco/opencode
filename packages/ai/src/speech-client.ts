import { Context } from "effect"
import { MediaClient } from "./media-client.js"
import type { SpeechEvent, SpeechRequest, SpeechResponse } from "./speech.js"

export type Interface = MediaClient.Interface<SpeechRequest, SpeechEvent, SpeechResponse>

export class SpeechClientService extends Context.Service<SpeechClientService, Interface>()("@opencode/SpeechClient") {}
export const Service = SpeechClientService
export type Service = SpeechClientService

export const SpeechClient = {
  Service,
  ...MediaClient.make(Service, {
    modality: "speech",
    responseEvents: (response: SpeechResponse) => [
      ...(response.timestamps === undefined ? [] : [{ type: "timestamps" as const, items: response.timestamps }]),
      {
        type: "finish" as const,
        audio: response.audio,
        usage: response.usage,
        providerMetadata: response.providerMetadata,
      },
    ],
  }),
} as const
