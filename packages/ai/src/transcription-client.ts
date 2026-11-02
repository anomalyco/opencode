import { Context } from "effect"
import { MediaClient } from "./media-client.js"
import {
  TranscriptionFinishEvent,
  type TranscriptionEvent,
  type TranscriptionRequest,
  type TranscriptionResponse,
} from "./transcription.js"

export type Interface = MediaClient.Interface<TranscriptionRequest, TranscriptionEvent, TranscriptionResponse>

export class TranscriptionClientService extends Context.Service<TranscriptionClientService, Interface>()(
  "@opencode/TranscriptionClient",
) {}
export const Service = TranscriptionClientService
export type Service = TranscriptionClientService

export const TranscriptionClient = {
  Service,
  ...MediaClient.make(Service, {
    modality: "transcription",
    responseEvents: (response: TranscriptionResponse) => [TranscriptionFinishEvent.make({ ...response })],
  }),
} as const
