export * as ReadTool from "./read"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { dirname } from "path"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Image } from "../image"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { SessionInstructions } from "../session/instructions"
import { AbsolutePath } from "../schema"
import { ReadToolFileSystem } from "./read-filesystem"
import { Tool } from "./tool"

export const name = "read"
const FILENAME = "AGENTS.md"
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

export const Plugin = {
  id: "opencode.tool.read",
  effect: Effect.fn("ReadTool.Plugin")(function* (ctx: PluginContext) {
    const reader = yield* ReadToolFileSystem.Service
    const mutation = yield* LocationMutation.Service
    const image = yield* Image.Service
    const permission = yield* PermissionV2.Service
    const sessionInstructions = yield* SessionInstructions.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description:
              "Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page. Relative paths resolve from the current location; absolute paths inside it are accepted, while external absolute paths require external_directory approval.",
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
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                const target = yield* mutation.resolve({ path: input.path, kind: "directory" })
                const external = target.externalDirectory
                if (external)
                  yield* permission.assert({
                    ...LocationMutation.externalDirectoryPermission(external),
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                const resource = target.resource
                const absolute = AbsolutePath.make(target.canonical)
                const type = yield* reader.inspect(absolute)
                yield* permission.assert({
                  action: name,
                  resources: [resource],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                const content =
                  type === "directory"
                    ? yield* reader.list(absolute, { offset: input.offset, limit: input.limit })
                    : yield* reader.read(absolute, resource, {
                        offset: input.offset,
                        limit: input.limit,
                      })
                // After a successful read, discover nearby AGENTS.md walking up to the Location
                // root exclusive and inject them as durable synthetic instructions. For a
                // directory listing the walk starts at the directory itself (so its own AGENTS.md
                // is discovered); for a file it starts at the file's dirname. External reads are
                // skipped, and discovery failures never fail the read.
                yield* Effect.gen(function* () {
                  if (target.externalDirectory !== undefined) return
                  const resolved = yield* fs.resolve(target.canonical)
                  const root = yield* fs.resolve(location.directory)
                  // up() searches its stop directory, so the Location-root AGENTS.md (already
                  // supplied by core initial instructions) is dropped by the dirname filter.
                  const discovered = yield* fs.up({
                    targets: [FILENAME],
                    start: type === "directory" ? resolved : dirname(resolved),
                    stop: root,
                  })
                  const candidates = (yield* Effect.forEach(discovered, fs.resolve)).filter(
                    (file) => dirname(file) !== root,
                  )
                  if (candidates.length === 0) return
                  yield* sessionInstructions.load({ sessionID: context.sessionID, paths: candidates })
                }).pipe(
                  Effect.catch(() => Effect.void),
                  Effect.catchDefect(() => Effect.void),
                )
                if ("encoding" in content && content.encoding === "base64" && SUPPORTED_IMAGE_MIMES.has(content.mime)) {
                  return yield* image
                    .normalize(resource, { ...content, encoding: "base64" })
                    .pipe(Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(content)))
                }
                if ("encoding" in content && content.encoding === "base64")
                  return yield* Effect.fail(new ReadToolFileSystem.BinaryFileError({ resource }))
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
                  return new ToolFailure({ message, error })
                }),
              )
            },
          }),
          { codemode: false },
        ),
      )
      .pipe(Effect.orDie)
  }),
}
