import { describe, expect, test } from "bun:test"
import { ImageSizing } from "../src/protocols/utils/image-sizing.js"

const GPT_IMAGE_2 = { multiple: 16, maxEdge: 3840, minPixels: 655_360, maxPixels: 8_294_400, maxRatio: 3 }
const STANDARD = [
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
]

describe("ImageSizing", () => {
  test("fits an aspect ratio at a resolution tier", () => {
    expect(ImageSizing.fit({}, { multiple: 16 })).toEqual({ width: 1024, height: 1024 })
    expect(ImageSizing.fit({ aspect: "16:9" }, GPT_IMAGE_2)).toEqual({ width: 1360, height: 768 })
    expect(ImageSizing.fit({ aspect: "9:16", resolution: "2K" }, GPT_IMAGE_2)).toEqual({ width: 1536, height: 2736 })
    expect(ImageSizing.fit({ aspect: "1:1", resolution: "0.5K" }, { multiple: 16 })).toEqual({
      width: 512,
      height: 512,
    })
  })

  test("stays within the provider's limits", () => {
    expect(ImageSizing.fit({ aspect: "16:9", resolution: "4K" }, GPT_IMAGE_2)).toEqual({ width: 3840, height: 2160 })
    expect(ImageSizing.fit({ aspect: "1:1", resolution: "4K" }, GPT_IMAGE_2)).toEqual({ width: 2880, height: 2880 })
    expect(ImageSizing.fit({ aspect: "1:1", resolution: "0.5K" }, GPT_IMAGE_2)).toEqual({ width: 816, height: 816 })
    expect(ImageSizing.fit({ aspect: "4:1" }, GPT_IMAGE_2)).toEqual({ width: 1776, height: 592 })
    expect(ImageSizing.fit({ aspect: "16:9", resolution: "2K" }, { multiple: 16, maxPixels: 2048 * 2048 })).toEqual({
      width: 2720,
      height: 1536,
    })
    expect(ImageSizing.fit({ aspect: "16:9" }, { multiple: 32, minEdge: 1024, maxEdge: 2048 })).toEqual({
      width: 1824,
      height: 1024,
    })
  })

  test("picks the nearest listed size by aspect, then by pixel count", () => {
    expect(ImageSizing.nearest({ aspect: "16:9" }, STANDARD)).toEqual({ width: 1536, height: 1024 })
    expect(ImageSizing.nearest({ aspect: "3:4" }, STANDARD)).toEqual({ width: 1024, height: 1536 })
    expect(
      ImageSizing.nearest(
        { resolution: "0.5K" },
        [256, 512, 1024].map((edge) => ({ width: edge, height: edge })),
      ),
    ).toEqual({ width: 512, height: 512 })
  })

  test("reports a size that misses the requested aspect or tier", () => {
    expect(ImageSizing.notice("OpenAI Images", { aspect: "16:9" }, { width: 1360, height: 768 })).toBeUndefined()
    expect(ImageSizing.notice("OpenAI Images", { aspect: "3:2" }, { width: 1536, height: 1024 })).toBeUndefined()
    expect(ImageSizing.notice("OpenAI Images", { aspect: "16:9" }, { width: 1536, height: 1024 })).toEqual({
      type: "other",
      message: "OpenAI Images doesn't offer 16:9; used 1536x1024 (3:2)",
    })
    expect(ImageSizing.notice("OpenAI Images", { resolution: "4K" }, { width: 2880, height: 2880 })).toEqual({
      type: "other",
      message: "OpenAI Images doesn't offer 4K; used 2880x2880 (1:1)",
    })
    expect(ImageSizing.notice("OpenAI Images", { resolution: "hd" }, { width: 1024, height: 1024 })?.message).toBe(
      "OpenAI Images doesn't offer hd; used 1024x1024 (1:1)",
    )
  })
})
