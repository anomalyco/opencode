import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigImagePlugin } from "@opencode/core/config/plugin/image"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Document, Event, Info, type Entry } from "@opencode/schema/config"
import { bytesToBase64 } from "@opencode/util/base64"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"
import { waitUntil } from "./lib/eventually"
import { PluginTestLayer } from "./plugin/fixture"

const decodeConfig = Schema.decodeUnknownSync(Info)
const inputBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const outputBytes = new Uint8Array([255, 216, 255, 224])
const sample = {
  uri: "file:///photo.png",
  content: bytesToBase64(inputBytes),
  encoding: "base64" as const,
  mime: "image/png",
}

const withResizer = (resizer: Image.Resizer) => AppNodeBuilder.build(Image.configured(resizer))
const it = testEffect(Layer.empty)

function document(image: NonNullable<typeof Info.Encoded.media>["image"]): Entry {
  return new Document({ type: "document", info: decodeConfig({ media: { image } }) })
}

describe("Image.configured", () => {
  it.effect("invokes an async host resizer with decoded bytes, mime, and default limits", () =>
    Effect.gen(function* () {
      const seen: Image.ResizerInput[] = []
      const resizer: Image.Resizer = async (input) => {
        seen.push(input)
        return { bytes: outputBytes, mime: "image/jpeg" }
      }
      const image = yield* Image.Service.pipe(Effect.provide(withResizer(resizer)))
      const normalized = yield* image.normalize("photo.png", sample)

      expect(seen).toHaveLength(1)
      expect(seen[0]?.bytes).toEqual(inputBytes)
      expect(seen[0]?.mime).toBe("image/png")
      expect(seen[0]?.limits).toEqual({
        autoResize: true,
        maxWidth: 2_000,
        maxHeight: 2_000,
        maxBase64Bytes: 5 * 1024 * 1024,
      })
      expect(normalized).toEqual({
        ...sample,
        content: bytesToBase64(outputBytes),
        encoding: "base64",
        mime: "image/jpeg",
      })
    }),
  )

  it.effect("accepts a synchronous host resizer", () =>
    Effect.gen(function* () {
      const image = yield* Image.Service.pipe(
        Effect.provide(withResizer(() => ({ bytes: outputBytes, mime: "image/webp" }))),
      )
      const normalized = yield* image.normalize("photo.png", sample)
      expect(normalized.mime).toBe("image/webp")
      expect(normalized.content).toBe(bytesToBase64(outputBytes))
    }),
  )

  it.effect("reflects transform updates and isolates internal state from callback mutations", () =>
    Effect.gen(function* () {
      const widths: number[] = []
      const resizer: Image.Resizer = (input) => {
        widths.push(input.limits.maxWidth)
        ;(input.limits as Image.Limits).maxWidth = 1
        return { bytes: outputBytes, mime: input.mime }
      }
      const image = yield* Image.Service.pipe(Effect.provide(withResizer(resizer)))
      yield* image.transform((editor) => editor.configure({ maxWidth: 1_200, maxHeight: 900 }))
      yield* image.normalize("first.png", sample)
      yield* image.normalize("second.png", sample)

      expect(widths).toEqual([1_200, 1_200])
    }),
  )

  it.live("applies media.image config transforms and reloads", () =>
    Effect.gen(function* () {
      let seenLimits: Readonly<Image.Limits> | undefined
      const resizer: Image.Resizer = (input) => {
        seenLimits = input.limits
        return { bytes: outputBytes, mime: input.mime }
      }
      const layer = Layer.merge(PluginTestLayer, withResizer(resizer))
      yield* Effect.gen(function* () {
        const image = yield* Image.Service
        const bus = yield* Bus.Service
        const config = yield* Config.Test
        const plugins = yield* Plugin.Service
        yield* ConfigImagePlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

        yield* image.normalize("photo.png", sample)
        expect(seenLimits).toEqual({
          autoResize: true,
          maxWidth: 1_200,
          maxHeight: 900,
          maxBase64Bytes: 5 * 1024 * 1024,
        })

        yield* config.setEntries([document({ max_width: 800, max_base64_bytes: 1_024 })])
        yield* bus.publish(Event.Updated, {})
        yield* waitUntil(
          image
            .normalize("photo.png", sample)
            .pipe(Effect.map(() => seenLimits?.maxWidth === 800 && seenLimits.maxBase64Bytes === 1_024)),
        )
      }).pipe(
        Effect.provide(Config.testLayer([document({ max_width: 1_200, max_height: 900 })])),
        Effect.provide(layer),
      )
    }),
  )

  it.effect("skips calling the host resizer when autoResize is false and enforces maxBase64Bytes", () =>
    Effect.gen(function* () {
      let calls = 0
      const image = yield* Image.Service.pipe(
        Effect.provide(
          withResizer((input) => {
            calls++
            return { bytes: outputBytes, mime: input.mime }
          }),
        ),
      )
      yield* image.transform((editor) => editor.configure({ autoResize: false, maxBase64Bytes: sample.content.length }))
      expect(yield* image.normalize("photo.png", sample)).toBe(sample)
      expect(calls).toBe(0)

      yield* image.transform((editor) =>
        editor.configure({ autoResize: false, maxBase64Bytes: sample.content.length - 1 }),
      )
      const error = yield* image.normalize("photo.png", sample).pipe(Effect.flip)
      expect(error).toEqual(
        new Image.SizeError({
          resource: "photo.png",
          width: 0,
          height: 0,
          bytes: sample.content.length,
          maxWidth: 2_000,
          maxHeight: 2_000,
          maxBytes: sample.content.length - 1,
        }),
      )
      expect(calls).toBe(0)
    }),
  )

  it.effect("accepts resizer output at the exact maxBase64Bytes limit and rejects one byte below", () =>
    Effect.gen(function* () {
      const outputBase64Length = bytesToBase64(outputBytes).length
      const image = yield* Image.Service.pipe(
        Effect.provide(withResizer(() => ({ bytes: outputBytes, mime: "image/jpeg" }))),
      )

      yield* image.transform((editor) => editor.configure({ maxBase64Bytes: outputBase64Length }))
      expect((yield* image.normalize("photo.png", sample)).content).toBe(bytesToBase64(outputBytes))

      yield* image.transform((editor) => editor.configure({ maxBase64Bytes: outputBase64Length - 1 }))
      const error = yield* image.normalize("photo.png", sample).pipe(Effect.flip)
      expect(error).toEqual(
        new Image.SizeError({
          resource: "photo.png",
          width: 0,
          height: 0,
          bytes: outputBase64Length,
          maxWidth: 2_000,
          maxHeight: 2_000,
          maxBytes: outputBase64Length - 1,
        }),
      )
    }),
  )

  it.effect("keeps the original image when the host resizer returns undefined and still enforces maxBase64Bytes", () =>
    Effect.gen(function* () {
      const image = yield* Image.Service.pipe(Effect.provide(withResizer(() => undefined)))
      expect(yield* image.normalize("photo.png", sample)).toBe(sample)

      yield* image.transform((editor) => editor.configure({ maxBase64Bytes: sample.content.length - 1 }))
      const error = yield* image.normalize("photo.png", sample).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Image.SizeError)
      expect(error.message).not.toContain("0x0")
      expect(error.message).toContain(`base64 size ${sample.content.length}`)
    }),
  )

  it.effect(
    "maps invalid base64 to DecodeError and resizer failures or invalid outputs to ResizerUnavailableError",
    () =>
      Effect.gen(function* () {
        const invalid = yield* Image.Service.pipe(
          Effect.provide(withResizer(() => ({ bytes: outputBytes, mime: "image/jpeg" }))),
        )
        expect(
          yield* invalid.normalize("bad.png", { ...sample, content: "%%%not-base64%%%" }).pipe(Effect.flip),
        ).toEqual(new Image.DecodeError({ resource: "bad.png" }))

        const syncThrow = yield* Image.Service.pipe(
          Effect.provide(
            withResizer(() => {
              throw new Error("service unavailable")
            }),
          ),
        )
        expect(yield* syncThrow.normalize("sync.png", sample).pipe(Effect.flip)).toEqual(
          new Image.ResizerUnavailableError(),
        )

        const asyncReject = yield* Image.Service.pipe(
          Effect.provide(
            withResizer(async () => {
              throw new Error("timeout")
            }),
          ),
        )
        expect(yield* asyncReject.normalize("async.png", sample).pipe(Effect.flip)).toEqual(
          new Image.ResizerUnavailableError(),
        )

        const unsupportedMime = yield* Image.Service.pipe(
          Effect.provide(withResizer(() => ({ bytes: outputBytes, mime: "image/avif" }))),
        )
        expect(yield* unsupportedMime.normalize("avif.png", sample).pipe(Effect.flip)).toEqual(
          new Image.ResizerUnavailableError(),
        )

        const emptyBytes = yield* Image.Service.pipe(
          Effect.provide(withResizer(() => ({ bytes: new Uint8Array(0), mime: "image/jpeg" }))),
        )
        expect(yield* emptyBytes.normalize("empty.png", sample).pipe(Effect.flip)).toEqual(
          new Image.ResizerUnavailableError(),
        )
      }),
  )
})
