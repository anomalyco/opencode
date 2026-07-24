import { describe, expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"
import { Image, ImageInput } from "../../src"
import { Alibaba } from "../../src/providers"
import { dimensions } from "../lib/image"
import { recordedTests } from "../recorded-test"

const alibaba = Alibaba.configure({
  apiKey: process.env.DASHSCOPE_API_KEY ?? "fixture",
})

const SIGNED_QUERY_CREDENTIALS = new Set(
  [
    "AccessKeyId",
    "AWSAccessKeyId",
    "GoogleAccessId",
    "OSSAccessKeyId",
    "Signature",
    "SecurityToken",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
    "X-Amz-Signature",
    "X-Goog-Credential",
    "X-Goog-Signature",
    "X-OSS-Security-Token",
  ].map((name) => name.replace(/[^a-z0-9]/gi, "").toLowerCase()),
)

const redactSignedUrl = (value: string) => {
  if (!URL.canParse(value)) return value
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") return value
  url.searchParams.forEach((_, name) => {
    if (SIGNED_QUERY_CREDENTIALS.has(name.replace(/[^a-z0-9]/gi, "").toLowerCase()))
      url.searchParams.set(name, "[REDACTED]")
  })
  return url.toString()
}

const redactSignedUrls = (body: string) =>
  Option.match(Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(body), {
    onNone: () => body,
    onSome: (value) =>
      JSON.stringify(
        (function redact(input: unknown): unknown {
          if (typeof input === "string") return redactSignedUrl(input)
          if (Array.isArray(input)) return input.map(redact)
          if (input === null || typeof input !== "object") return input
          return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, redact(child)]))
        })(value),
      ),
  })

const recorded = recordedTests({
  prefix: "alibaba-images",
  provider: "alibaba",
  protocol: "alibaba-images",
  requires: ["DASHSCOPE_API_KEY"],
  options: { redact: { body: redactSignedUrls } },
})

const inspectLive = async (value: string | Uint8Array | undefined) => {
  if (process.env.RECORD !== "true" || typeof value !== "string") return
  const response = await fetch(value)
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(response.headers.get("content-type")).toMatch(/^image\//)
  expect(dimensions(bytes).width).toBeGreaterThan(0)
  expect(dimensions(bytes).height).toBeGreaterThan(0)
}

test("recorder redacts signed URL credentials in nested JSON strings repeatably", () => {
  const body = JSON.stringify({
    output: {
      image:
        "https://example.oss.aliyuncs.com/image.png?Expires=1893456000&OSSAccessKeyId=access&Signature=signature&x-oss-security-token=token",
    },
    mirrors: ["https://storage.googleapis.com/image.png?X-Goog-Credential=credential&X-Goog-Signature=signature"],
  })
  const once = redactSignedUrls(body)
  const twice = redactSignedUrls(once)
  const parsed = JSON.parse(once)
  const oss = new URL(parsed.output.image)
  const gcs = new URL(parsed.mirrors[0])

  expect(oss.searchParams.get("Expires")).toBe("1893456000")
  expect(oss.searchParams.get("OSSAccessKeyId")).toBe("[REDACTED]")
  expect(oss.searchParams.get("Signature")).toBe("[REDACTED]")
  expect(oss.searchParams.get("x-oss-security-token")).toBe("[REDACTED]")
  expect(gcs.searchParams.get("X-Goog-Credential")).toBe("[REDACTED]")
  expect(gcs.searchParams.get("X-Goog-Signature")).toBe("[REDACTED]")
  expect(twice).toBe(once)
})

describe("Alibaba Images recorded", () => {
  recorded.effect("generates with Qwen Image 2.0", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: alibaba.image("qwen-image-2.0"),
        prompt: "A simple flat black circle centered on a plain white background.",
        options: { size: "512*512", promptExtend: false, watermark: false },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/png")
      expect(response.image?.data).toStartWith("https://")
    }),
  )

  recorded.effect("generates with Wan 2.7", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: alibaba.image("wan2.7-image"),
        prompt: "A simple flat black square centered on a plain white background.",
        options: { resolution: "1K", thinkingMode: false, watermark: false },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/png")
      expect(response.image?.data).toStartWith("https://")
    }),
  )

  recorded.effect("edits with Qwen Image 2.0", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: alibaba.image("qwen-image-2.0"),
        prompt: "Turn the black source shape into a bright orange sun icon on a pale blue background.",
        images: [
          ImageInput.bytes(
            yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
            "image/jpeg",
          ),
        ],
        options: { promptExtend: false, watermark: false },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/png")
      expect(response.image?.data).toStartWith("https://")
      yield* Effect.promise(() => inspectLive(response.image?.data))
    }),
  )

  recorded.effect("edits with Wan 2.7", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: alibaba.image("wan2.7-image"),
        prompt: "Turn the black source shape into a bright orange sun icon on a pale blue background.",
        images: [
          ImageInput.bytes(
            yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source-256.jpg").bytes()),
            "image/jpeg",
          ),
        ],
        options: { resolution: "1K", thinkingMode: false, watermark: false },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/png")
      expect(response.image?.data).toStartWith("https://")
      yield* Effect.promise(() => inspectLive(response.image?.data))
    }),
  )
})
