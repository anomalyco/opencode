export * as ReadTool from "./read"

import { ToolFailure } from "@opencode-ai/llm"
// @ts-ignore Bun's static file import is embedded by `bun build --compile`; some consumers also declare *.wasm.
import photonWasm from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" }
import { Effect, Layer, Schema } from "effect"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Config } from "../config"
import { FileSystem } from "../filesystem"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "read"
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_WIDTH = 2_000
const MAX_IMAGE_HEIGHT = 2_000
const JPEG_QUALITIES = [80, 85, 70, 55, 40]

class ImageDecodeError extends Error {
  constructor(readonly resource: string) {
    super(`Image could not be decoded: ${resource}`)
    this.name = "ImageDecodeError"
  }
}

class ImageSizeError extends Error {
  constructor(
    readonly resource: string,
    readonly width: number,
    readonly height: number,
    readonly bytes: number,
    readonly maxWidth: number,
    readonly maxHeight: number,
    readonly maxBytes: number,
  ) {
    super(
      `Image ${resource} is ${width}x${height} with base64 size ${bytes}, exceeding configured limits ${maxWidth}x${maxHeight}/${maxBytes} bytes`,
    )
    this.name = "ImageSizeError"
  }
}
const LocationInput = Schema.Struct({
  ...FileSystem.ReadInput.fields,
  offset: FileSystem.ListPageInput.fields.offset.annotate({
    description: "The 1-based directory entry or text line offset to start reading from",
  }),
  limit: FileSystem.ListPageInput.fields.limit.annotate({
    description: "The maximum number of directory entries or text lines to read",
  }),
})
const Input = LocationInput
const Success = Schema.Union([FileSystem.Content, FileSystem.TextPage, FileSystem.ListPage])

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const filesystem = yield* FileSystem.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service
    const loadPhoton = yield* Effect.cached(
      Effect.sync(() => {
        ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH =
          path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
      }).pipe(Effect.andThen(() => Effect.promise(() => import("@silvia-odwyer/photon-node")))),
    )

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page relative to the current location. Absolute paths are accepted only for managed tool-output files.",
          input: Input,
          output: Success,
          toModelOutput: ({ input, output }) => {
            if (!("type" in output) || output.type !== "binary" || !SUPPORTED_IMAGE_MIMES.has(output.mime)) return []
            return [
              { type: "text", text: "Image read successfully" },
              { type: "file", data: output.content, mime: output.mime, name: input.path },
            ]
          },
          execute: (input, context) => {
            return Effect.gen(function* () {
              const resolved = yield* filesystem.resolveReadPath(input)
              yield* permission.assert({
                action: name,
                resources: [resolved.resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              if (resolved.type === "directory") return yield* filesystem.listPage(input)
              const content = yield* filesystem.readTool(input, {
                offset: input.offset,
                limit: input.limit,
              })
              if (content.type === "binary" && SUPPORTED_IMAGE_MIMES.has(content.mime)) {
                const mime = content.mime
                const base64 = content.content
                const image = Object.assign(
                  {},
                  ...(yield* config.entries()).flatMap((entry) =>
                    entry.type === "document" && entry.info.attachments?.image ? [entry.info.attachments.image] : [],
                  ),
                )
                const limits = {
                  autoResize: image.auto_resize ?? true,
                  maxWidth: image.max_width ?? MAX_IMAGE_WIDTH,
                  maxHeight: image.max_height ?? MAX_IMAGE_HEIGHT,
                  maxBase64Bytes: image.max_base64_bytes ?? MAX_IMAGE_BASE64_BYTES,
                }
                const photon = yield* loadPhoton
                const decoded = yield* Effect.try({
                  try: () => photon.PhotonImage.new_from_byteslice(Buffer.from(base64, "base64")),
                  catch: () => new ImageDecodeError(resolved.resource),
                })
                try {
                  const width = decoded.get_width()
                  const height = decoded.get_height()
                  const bytes = Buffer.byteLength(base64, "utf-8")
                  if (width <= limits.maxWidth && height <= limits.maxHeight && bytes <= limits.maxBase64Bytes)
                    return new FileSystem.BinaryContent({ type: "binary", content: base64, encoding: "base64", mime })
                  if (!limits.autoResize)
                    return yield* Effect.fail(
                      new ImageSizeError(
                        resolved.resource,
                        width,
                        height,
                        bytes,
                        limits.maxWidth,
                        limits.maxHeight,
                        limits.maxBase64Bytes,
                      ),
                    )
                  const scale = Math.min(1, limits.maxWidth / width, limits.maxHeight / height)
                  const sizes = Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>((acc) => {
                    const previous = acc.at(-1) ?? {
                      width: Math.max(1, Math.round(width * scale)),
                      height: Math.max(1, Math.round(height * scale)),
                    }
                    const next =
                      acc.length === 0
                        ? previous
                        : {
                            width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
                            height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75)),
                          }
                    return acc.some((item) => item.width === next.width && item.height === next.height)
                      ? acc
                      : [...acc, next]
                  }, [])
                  for (const size of sizes) {
                    const resized = photon.resize(decoded, size.width, size.height, photon.SamplingFilter.Lanczos3)
                    try {
                      const candidate = [
                        { content: Buffer.from(resized.get_bytes()).toString("base64"), mime: "image/png" },
                        ...JPEG_QUALITIES.map((quality) => ({
                          content: Buffer.from(resized.get_bytes_jpeg(quality)).toString("base64"),
                          mime: "image/jpeg",
                        })),
                      ].find((item) => Buffer.byteLength(item.content, "utf-8") <= limits.maxBase64Bytes)
                      if (candidate)
                        return new FileSystem.BinaryContent({
                          type: "binary",
                          content: candidate.content,
                          encoding: "base64",
                          mime: candidate.mime,
                        })
                    } finally {
                      resized.free()
                    }
                  }
                  return yield* Effect.fail(
                    new ImageSizeError(
                      resolved.resource,
                      width,
                      height,
                      bytes,
                      limits.maxWidth,
                      limits.maxHeight,
                      limits.maxBase64Bytes,
                    ),
                  )
                } finally {
                  decoded.free()
                }
              }
              if (content.type === "binary")
                return yield* Effect.fail(new FileSystem.BinaryFileError(resolved.resource))
              return content
            }).pipe(
              Effect.mapError((error) => {
                const message =
                  error instanceof FileSystem.BinaryFileError ||
                  error instanceof FileSystem.MediaIngestLimitError ||
                  error instanceof ImageDecodeError ||
                  error instanceof ImageSizeError
                    ? error.message
                    : `Unable to read ${input.path}`
                return new ToolFailure({ message })
              }),
            )
          },
        }),
      })
      .pipe(Effect.orDie)
  }),
)
