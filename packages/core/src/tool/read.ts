export * as ReadTool from "./read"

import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"

export const name = "read"
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
const imageMime = (bytes: Uint8Array, fallback: string) => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))
    return "image/webp"
  return fallback
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

const definition = Tool.make({
  description:
    "Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page relative to the current location. Absolute paths are accepted only for managed tool-output files.",
  parameters: Input,
  success: Success,
  toModelOutput: ({ parameters, output }) => {
    if (!("type" in output) || output.type !== "binary" || !SUPPORTED_IMAGE_MIMES.has(output.mime)) return []
    return [
      { type: "text", text: "Image read successfully" },
      {
        type: "file",
        source: { type: "data", data: output.content },
        mime: output.mime,
        name: parameters.path,
      },
    ]
  },
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const filesystem = yield* FileSystem.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID, assertPermission }) => {
          const input = parameters
          return Effect.gen(function* () {
            const resolved = yield* filesystem.resolveReadPath(input)
            if (resolved.type === "directory") {
              const { offset, limit } = input
              const target = resolved.target
              yield* assertPermission({ action: name, resources: [target.resource], save: ["*"] })
              const final = yield* filesystem.resolveReadPath(input)
              if (
                final.type !== "directory" ||
                final.target.resource !== target.resource ||
                final.target.real !== target.real
              )
                return yield* Effect.die(new Error("Directory changed after permission approval"))
              return yield* filesystem.listPageResolved(final.target, { offset, limit })
            }
            const target = resolved.target
            yield* assertPermission({
              action: name,
              resources: [target.resource],
              save: ["*"],
            })
            const final = yield* filesystem.resolveReadPath(input)
            if (final.type !== "file" || final.target.resource !== target.resource || final.target.real !== target.real)
              return yield* Effect.die(new Error("File changed after permission approval"))
            const sample = yield* filesystem.readSampleResolved(final.target, FileSystem.READ_SAMPLE_BYTES)
            const mime = imageMime(sample, FSUtil.mimeType(final.target.real))
            if (SUPPORTED_IMAGE_MIMES.has(mime)) {
              const content = yield* filesystem.readResolved(final.target)
              return new FileSystem.BinaryContent({
                type: "binary",
                content:
                  content.type === "binary"
                    ? content.content
                    : Buffer.from(content.content, "utf-8").toString("base64"),
                encoding: "base64",
                mime,
              })
            }
            if (FileSystem.isBinary(final.target.resource, sample))
              return yield* Effect.die(new FileSystem.BinaryFileError(final.target.resource))
            if (
              final.target.size > FileSystem.MAX_READ_BYTES ||
              input.offset !== undefined ||
              input.limit !== undefined
            )
              return yield* filesystem.readTextPageResolved(final.target, { offset: input.offset, limit: input.limit })
            const content = yield* filesystem.readResolved(final.target, FileSystem.MAX_READ_BYTES)
            if (content.type === "binary")
              return yield* Effect.die(new FileSystem.BinaryFileError(final.target.resource))
            return content
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                const error = Cause.squash(cause)
                const message =
                  error instanceof FileSystem.BinaryFileError || error instanceof FileSystem.ReadLimitError
                    ? error.message
                    : `Unable to read ${input.path}`
                return yield* new ToolFailure({ message, error })
              }),
            ),
          )
        },
      }),
    )
  }),
)
export const locationLayer = layer.pipe(
  Layer.provideMerge(ToolRegistry.defaultLayer),
  Layer.provideMerge(FileSystem.locationLayer),
  Layer.provideMerge(PermissionV2.locationLayer),
)
