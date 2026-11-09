import { describe, expect, test } from "bun:test"
import { Base64 } from "effect/encoding"
import { ai, AIError, Media, Message } from "../src/effect.js"
import { OpenAI, OpenCode } from "../src/providers.js"

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const PNG_BASE64 = Base64.encode(PNG)
const UNKNOWN = Uint8Array.from([1, 2, 3])

describe("Media.make", () => {
  test("passes assets through", () => {
    const asset = Media.url("https://example.test/a.png")
    expect(Media.make(asset)).toBe(asset)
  })

  test("sniffs bytes and array buffers", () => {
    expect(Media.make(PNG).source).toEqual({ type: "bytes", data: PNG, mediaType: "image/png" })
    expect(Media.make(PNG.slice().buffer).source).toEqual({ type: "bytes", data: PNG, mediaType: "image/png" })
    expect(Media.make(UNKNOWN, "application/x-thing").mediaType).toBe("application/x-thing")
  })

  test("reads the media type from data URLs", () => {
    expect(Media.make(`data:image/png;base64,${PNG_BASE64}`).source).toEqual({
      type: "base64",
      data: PNG_BASE64,
      mediaType: "image/png",
    })
    expect(Media.make(new URL(`data:image/webp;base64,${PNG_BASE64}`)).mediaType).toBe("image/webp")
  })

  test("keeps http(s) and other URLs as url sources", () => {
    expect(Media.make("https://example.test/a.png", "image/png").source).toEqual({
      type: "url",
      url: "https://example.test/a.png",
      mediaType: "image/png",
    })
    expect(Media.make(new URL("gs://bucket/a.pdf")).source).toEqual({ type: "url", url: "gs://bucket/a.pdf" })
  })

  test("treats other strings as base64", () => {
    expect(Media.make(PNG_BASE64).source).toEqual({ type: "base64", data: PNG_BASE64, mediaType: "image/png" })
    expect(Media.make("AQID", "application/pdf").mediaType).toBe("application/pdf")
  })

  test("requires a mediaType when the type cannot be detected", () => {
    expect(() => Media.make(UNKNOWN)).toThrow(AIError)
    expect(() => Media.make("AQID")).toThrow(AIError)
    expect(() => Media.make("data:text/plain,hello")).toThrow(AIError)
  })

  test("rejects strings that are not base64", () => {
    expect(() => Media.make("./photo.png", "image/png")).toThrow("Media.file")
  })

  test("matches the data URL scheme in any case", () => {
    expect(Media.make(`DATA:image/png;base64,${PNG_BASE64}`).mediaType).toBe("image/png")
  })
})

describe("plain file input", () => {
  test("request media parts accept plain data", () => {
    const request = ai.request({
      model: OpenAI.configure({ apiKey: "test" }).chat("gpt-4o-mini"),
      prompt: [
        { type: "text", text: "Describe these" },
        { type: "media", media: PNG, filename: "a.png" },
        { type: "media", media: "AQID", mediaType: "application/pdf" },
        Message.media(new URL("https://example.test/a.png")),
      ],
    })
    const parts = request.messages[0].content
    expect(parts[1]).toEqual({ type: "media", media: Media.bytes(PNG, "image/png"), filename: "a.png" })
    expect(parts[2]).toEqual({ type: "media", media: Media.base64("AQID", "application/pdf") })
    expect(parts[3]).toEqual({ type: "media", media: Media.url("https://example.test/a.png") })
  })

  test("image edit inputs accept plain data", () => {
    const request = ai.image.request({
      model: OpenAI.configure({ apiKey: "test" }).image("gpt-image-2"),
      prompt: "Make it blue",
      images: [PNG, `data:image/png;base64,${PNG_BASE64}`, "https://example.test/a.png"],
    })
    expect(request.images?.map((image) => image.source.type)).toEqual(["bytes", "base64", "url"])
    expect(request.images?.[0].mediaType).toBe("image/png")
  })

  test("decision media parts accept plain data", () => {
    const request = ai.decision.request({
      model: OpenCode.configure({ apiKey: "test" }).decision("jev-1.13"),
      input: [
        { type: "text", text: "Is this a receipt?" },
        { type: "media", media: "AQID", mediaType: "image/png", filename: "a.png" },
      ],
      questions: [{ name: "receipt", type: "predicate", instructions: "Is this a receipt?" }],
    })
    expect(request.input[1]).toEqual({ type: "media", media: Media.base64("AQID", "image/png"), filename: "a.png" })
  })
})
