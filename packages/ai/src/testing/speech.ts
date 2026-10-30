import { Context } from "effect"
import { SpeechClient } from "../speech-client.js"
import type { SpeechEvent, SpeechRequestFor, SpeechResponse } from "../speech.js"
import { TestMedia } from "./media.js"
import type { TestScript } from "./script.js"

export type Response = TestMedia.Response<SpeechResponse>

export interface TestInterface extends TestMedia.TestInterface<SpeechRequestFor, SpeechEvent, SpeechResponse> {}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/ai/TestSpeech/Test") {}

export type LayerOptions = TestScript.Options<SpeechRequestFor, Response>

/** Provides one shared implementation under `SpeechClient.Service` and `TestSpeech.Test`. */
export const testLayer = (options: LayerOptions = {}) =>
  TestMedia.testLayer(SpeechClient.Service, Test, {
    name: "TestSpeech",
    responseEvents: SpeechClient.responseEvents,
    options,
  })

export * as TestSpeech from "./speech.js"
