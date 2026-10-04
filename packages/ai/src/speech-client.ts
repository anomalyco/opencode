import { Context } from "effect"
import { MediaClient } from "./media-client.js"
import {
  SpeechTimestampsEvent,
  SpeechFinishEvent,
  type SpeechEvent,
  type SpeechRequestFor,
  type SpeechResponse,
} from "./speech.js"

export type Interface = MediaClient.Interface<SpeechRequestFor, SpeechEvent, SpeechResponse>

export class SpeechClientService extends Context.Service<SpeechClientService, Interface>()("@opencode/SpeechClient") {}
export const Service = SpeechClientService
export type Service = SpeechClientService

export const SpeechClient = {
  Service,
  ...MediaClient.make(Service, {
    modality: "speech",
    responseEvents: (response: SpeechResponse) => [
      ...(response.timestamps === undefined ? [] : [SpeechTimestampsEvent.make({ items: response.timestamps })]),
      SpeechFinishEvent.make({
        audio: response.audio,
        usage: response.usage,
        notices: response.notices,
        providerMetadata: response.providerMetadata,
      }),
    ],
  }),
} as const
