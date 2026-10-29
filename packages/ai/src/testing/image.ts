import { Context } from "effect"
import { ImageClient } from "../image-client.js"
import type { ImageEvent, ImageRequestFor, ImageResponse } from "../image.js"
import { TestMedia } from "./media.js"
import type { TestScript } from "./script.js"

export type Response = TestMedia.Response<ImageResponse>

export interface TestInterface extends TestMedia.TestInterface<ImageRequestFor, ImageEvent, ImageResponse> {}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/ai/TestImage/Test") {}

export type LayerOptions = TestScript.Options<ImageRequestFor, Response>

/** Provides one shared implementation under `ImageClient.Service` and `TestImage.Test`. */
export const testLayer = (options: LayerOptions = {}) =>
  TestMedia.testLayer(ImageClient.Service, Test, {
    name: "TestImage",
    responseEvents: ImageClient.responseEvents,
    options,
  })

export * as TestImage from "./image.js"
