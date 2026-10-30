import { Context } from "effect"
import { VideoClient } from "../video-client.js"
import type { VideoEvent, VideoRequestFor, VideoResponse } from "../video.js"
import { TestMedia } from "./media.js"
import type { TestScript } from "./script.js"

export type Response = TestMedia.Response<VideoResponse>

export interface TestInterface extends TestMedia.TestInterface<VideoRequestFor, VideoEvent, VideoResponse> {}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/ai/TestVideo/Test") {}

export type LayerOptions = TestScript.Options<VideoRequestFor, Response>

/** Provides one shared implementation under `VideoClient.Service` and `TestVideo.Test`. */
export const testLayer = (options: LayerOptions = {}) =>
  TestMedia.testLayer(VideoClient.Service, Test, {
    name: "TestVideo",
    responseEvents: VideoClient.responseEvents,
    options,
  })

export * as TestVideo from "./video.js"
