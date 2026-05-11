import { Config } from "@/config/config"
import type { MessageV2 } from "@/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { Context, Effect, Layer, Schema } from "effect"

const MAX_BASE64_BYTES = 4.5 * 1024 * 1024
const MAX_WIDTH = 2000
const MAX_HEIGHT = 2000
const AUTO_RESIZE = true
const JPEG_QUALITIES = [80, 85, 70, 55, 40]
const log = Log.create({ service: "image" })

export class PhotonUnavailableError extends Schema.TaggedErrorClass<PhotonUnavailableError>()(
  "ImagePhotonUnavailableError",
  {},
) {
  override get message() {
    return "Photon image processor is unavailable"
  }
}

export class InvalidDataUrlError extends Schema.TaggedErrorClass<InvalidDataUrlError>()("ImageInvalidDataUrlError", {
  url: Schema.String,
}) {
  override get message() {
    return "Image URL must be a base64 data URL"
  }
}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()("ImageDecodeError", {}) {
  override get message() {
    return "Image could not be decoded"
  }
}

export class SizeError extends Schema.TaggedErrorClass<SizeError>()("ImageSizeError", {
  bytes: Schema.Number,
  max: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  max_width: Schema.Number,
  max_height: Schema.Number,
}) {
  override get message() {
    return `Image ${this.width}x${this.height} with base64 size ${this.bytes} exceeds configured limits and could not be resized below ${this.max_width}x${this.max_height}/${this.max} bytes`
  }
}

export type Error = PhotonUnavailableError | InvalidDataUrlError | DecodeError | SizeError

export interface Interface {
  readonly normalize: (input: MessageV2.FilePart) => Effect.Effect<MessageV2.FilePart, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Image") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const loadPhoton = yield* Effect.cached(
      Effect.promise(async () => {
        try {
          const photonWasm = (await import("@silvia-odwyer/photon-node/photon_rs_bg.wasm", { with: { type: "file" } }))
            .default
          // Patched photon-node reads this during module init so Bun compiled binaries use the embedded wasm path.
          ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH =
            photonWasm
          return await import("@silvia-odwyer/photon-node")
        } catch {
          return null
        }
      }),
    )

    const normalize = Effect.fn("Image.normalize")(function* (input: MessageV2.FilePart) {
      const image = (yield* config.get()).attachment?.image
      const info = {
        autoResize: image?.auto_resize ?? AUTO_RESIZE,
        maxWidth: image?.max_width ?? MAX_WIDTH,
        maxHeight: image?.max_height ?? MAX_HEIGHT,
        maxBase64Bytes: image?.max_base64_bytes ?? MAX_BASE64_BYTES,
      }
      if (!input.url.startsWith("data:") || !input.url.includes(";base64,"))
        return yield* new InvalidDataUrlError({ url: input.url })

      const base64 = input.url.slice(input.url.indexOf(";base64,") + ";base64,".length)
      const photon = yield* loadPhoton
      if (!photon) return yield* new PhotonUnavailableError()

      const decoded = yield* Effect.sync(() => {
        try {
          return photon.PhotonImage.new_from_byteslice(Buffer.from(base64, "base64"))
        } catch {
          return undefined
        }
      })
      if (!decoded) return yield* new DecodeError()

      try {
        const originalWidth = decoded.get_width()
        const originalHeight = decoded.get_height()
        if (
          originalWidth <= info.maxWidth &&
          originalHeight <= info.maxHeight &&
          Buffer.byteLength(base64, "utf8") <= info.maxBase64Bytes
        )
          return input
        if (!info.autoResize)
          return yield* new SizeError({
            bytes: Buffer.byteLength(base64, "utf8"),
            max: info.maxBase64Bytes,
            width: originalWidth,
            height: originalHeight,
            max_width: info.maxWidth,
            max_height: info.maxHeight,
          })

        const scale = Math.min(1, info.maxWidth / originalWidth, info.maxHeight / originalHeight)
        for (const size of Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>((acc) => {
          const previous = acc.at(-1) ?? {
            width: Math.max(1, Math.round(originalWidth * scale)),
            height: Math.max(1, Math.round(originalHeight * scale)),
          }
          const next =
            acc.length === 0
              ? previous
              : {
                  width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
                  height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75)),
                }
          return acc.some((item) => item.width === next.width && item.height === next.height) ? acc : [...acc, next]
        }, [])) {
          const resized = photon.resize(decoded, size.width, size.height, photon.SamplingFilter.Lanczos3)
          const candidate = [
            { data: Buffer.from(resized.get_bytes()).toString("base64"), mime: "image/png" },
            ...JPEG_QUALITIES.map((quality) => ({
              data: Buffer.from(resized.get_bytes_jpeg(quality)).toString("base64"),
              mime: "image/jpeg",
            })),
          ]
            .map((item) => ({ ...item, bytes: Buffer.byteLength(item.data, "utf8") }))
            .find((item) => item.bytes <= info.maxBase64Bytes)
          resized.free()

          if (candidate) {
            log.info("using resized image", {
              from_mime: input.mime,
              to_mime: candidate.mime,
              from: `${originalWidth}x${originalHeight}`,
              to: `${size.width}x${size.height}`,
            })
            return {
              ...input,
              mime: candidate.mime,
              url: `data:${candidate.mime};base64,${candidate.data}`,
            }
          }
        }

        return yield* new SizeError({
          bytes: Buffer.byteLength(base64, "utf8"),
          max: info.maxBase64Bytes,
          width: originalWidth,
          height: originalHeight,
          max_width: info.maxWidth,
          max_height: info.maxHeight,
        })
      } finally {
        decoded.free()
      }
    })

    return Service.of({ normalize })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as Image from "./image"
