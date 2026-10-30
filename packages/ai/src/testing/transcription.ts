import { Context } from "effect"
import { TranscriptionClient } from "../transcription-client.js"
import type { TranscriptionEvent, TranscriptionRequestFor, TranscriptionResponse } from "../transcription.js"
import { TestMedia } from "./media.js"
import type { TestScript } from "./script.js"

export type Response = TestMedia.Response<TranscriptionResponse>

export interface TestInterface
  extends TestMedia.TestInterface<TranscriptionRequestFor, TranscriptionEvent, TranscriptionResponse> {}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/ai/TestTranscription/Test") {}

export type LayerOptions = TestScript.Options<TranscriptionRequestFor, Response>

/** Provides one shared implementation under `TranscriptionClient.Service` and `TestTranscription.Test`. */
export const testLayer = (options: LayerOptions = {}) =>
  TestMedia.testLayer(TranscriptionClient.Service, Test, {
    name: "TestTranscription",
    responseEvents: TranscriptionClient.responseEvents,
    options,
  })

export * as TestTranscription from "./transcription.js"
