export * as ReadTool from "./read"

import { ToolFailure } from "@opencode-ai/llm"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Image } from "../image"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { AbsolutePath } from "../schema"
import { ReadToolFileSystem } from "./read-filesystem"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "read"
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const LocationInput = Schema.Struct({
  path: Schema.String,
  offset: ReadToolFileSystem.PageInput.fields.offset.annotate({
    description: "The 1-based directory entry or text line offset to start reading from",
  }),
  limit: ReadToolFileSystem.PageInput.fields.limit.annotate({
    description: "The maximum number of directory entries or text lines to read",
  }),
})
const Input = LocationInput
const Output = Schema.Union([FileSystem.Content, ReadToolFileSystem.TextPage, ReadToolFileSystem.ListPage])

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const reader = yield* ReadToolFileSystem.Service
    const location = yield* Location.Service
    const image = yield* Image.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page. Relative paths resolve from the current location; absolute paths are read directly.",
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => {
            if (!("encoding" in output) || output.encoding !== "base64" || !SUPPORTED_IMAGE_MIMES.has(output.mime))
              return []
            return [
              { type: "text", text: "Image read successfully" },
              { type: "file", data: output.content, mime: output.mime, name: input.path },
            ]
          },
          execute: (input, context) => {
            return Effect.gen(function* () {
              const absolute = path.resolve(location.directory, input.path)
              const selected = path.isAbsolute(input.path) ? path.dirname(absolute) : location.directory
              if (!path.isAbsolute(input.path) && !FSUtil.contains(location.directory, absolute))
                return yield* Effect.die(new Error("Path escapes the allowed read root"))
              const real = yield* fs.realPath(absolute)
              const root = yield* fs.realPath(selected)
              if (!FSUtil.contains(root, real))
                return yield* Effect.die(new Error("Path escapes the allowed read root"))
              const resource = path.relative(root, real).replaceAll("\\", "/") || "."
              const target = AbsolutePath.make(real)
              const type = yield* reader.inspect(target)
              yield* permission.assert({
                action: name,
                resources: [resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              if (type === "directory") return yield* reader.list(target, { offset: input.offset, limit: input.limit })
              const content = yield* reader.read(target, resource, {
                offset: input.offset,
                limit: input.limit,
              })
              if ("encoding" in content && content.encoding === "base64" && SUPPORTED_IMAGE_MIMES.has(content.mime)) {
                return yield* image
                  .normalize(resource, { ...content, encoding: "base64" })
                  .pipe(Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(content)))
              }
              if ("encoding" in content && content.encoding === "base64")
                return yield* Effect.fail(new ReadToolFileSystem.BinaryFileError(resource))
              return content
            }).pipe(
              Effect.mapError((error) => {
                const message =
                  error instanceof ReadToolFileSystem.BinaryFileError ||
                  error instanceof ReadToolFileSystem.MediaIngestLimitError ||
                  error instanceof Image.DecodeError ||
                  error instanceof Image.SizeError
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
