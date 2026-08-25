export * as ReadTool from "./read.js"

import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { basename, dirname, join } from "path"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "../../location.js"
import { LocationMutation } from "../../location-mutation.js"
import { Permission } from "../../permission.js"
import { SessionInstructions } from "../../session/instructions.js"
import { AbsolutePath } from "../../schema.js"
import { ReadToolFileSystem } from "../read-filesystem.js"
import { Environment } from "../../environment/index.js"

export const name = "read"
const FILENAME = "AGENTS.md"
const SUPPORTED_MEDIA_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"])
const LocationInput = Schema.Struct({
  path: Schema.String.annotate({ description: "File or directory to read" }),
  offset: ReadToolFileSystem.PageInput.fields.offset.annotate({
    description: "The line or directory entry to start reading from (1-based)",
  }),
  limit: ReadToolFileSystem.PageInput.fields.limit.annotate({
    description: "The maximum number of lines or directory entries to read (defaults to 2000)",
  }),
})
export const Input = LocationInput
const Output = Schema.Union([ReadToolFileSystem.FileContent, ReadToolFileSystem.TextPage, ReadToolFileSystem.ListPage])

export const Plugin = {
  id: "opencode.tool.read",
  effect: Effect.fn("ReadTool.Plugin")(function* (ctx: PluginContext) {
    const reader = yield* ReadToolFileSystem.Service
    const mutation = yield* LocationMutation.Service
    const permission = yield* Permission.Service
    const sessionInstructions = yield* SessionInstructions.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add({
          name,
          options: { codemode: false },
          description:
            "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
          input: Input,
          output: Output,
          execute: (input, context) => {
            return Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              const target = yield* mutation.resolve({ path: input.path })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              const resource = target.resource
              const absolute = AbsolutePath.make(target.absolute)
              yield* permission.assert({
                action: name,
                resources: [resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const content = yield* reader.read(absolute, resource, { offset: input.offset, limit: input.limit }).pipe(
                Effect.catchIf(
                  (error) => error instanceof Environment.NotFound,
                  () => missing(input.path, target.absolute),
                ),
              )
              // After a successful read, discover nearby AGENTS.md walking up to the Location
              // root exclusive and inject them as durable synthetic instructions. For a
              // directory listing the walk starts at the directory itself (so its own AGENTS.md
              // is discovered); for a file it starts at the file's dirname. External reads are
              // skipped, and discovery failures never fail the read.
              yield* Effect.gen(function* () {
                if (target.externalDirectory !== undefined) return
                const resolved = yield* fs.resolve(target.absolute)
                const root = yield* fs.resolve(location.directory)
                // up() searches its stop directory, so the Location-root AGENTS.md (already
                // supplied by core initial instructions) is dropped by the dirname filter.
                const discovered = yield* fs.up({
                  targets: [FILENAME],
                  start: content.type === "list-page" ? resolved : dirname(resolved),
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
              if (content.type === "file" && content.encoding === "base64" && !SUPPORTED_MEDIA_MIMES.has(content.mime))
                return yield* Effect.fail(new ReadToolFileSystem.BinaryFileError({ resource }))
              return content
            }).pipe(
              Effect.map((output) => ({
                output,
                content: toModelContent(input.path, input.offset, output),
                metadata: { truncated: output.type === "file" ? false : output.truncated },
              })),
              Effect.mapError((error) => {
                if (error instanceof ToolFailure) return error
                const message =
                  error instanceof ReadToolFileSystem.BinaryFileError ||
                  error instanceof ReadToolFileSystem.MediaIngestLimitError ||
                  error instanceof ReadToolFileSystem.OffsetOutOfRangeError ||
                  error instanceof ReadToolFileSystem.PathKindError
                    ? error.message
                    : `Unable to read ${input.path}`
                return new ToolFailure({ message, error })
              }),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    const missing = Effect.fn("ReadTool.missing")(function* (input: string, absolute: string) {
      const base = basename(input).toLowerCase()
      const suggestions = yield* fs.readDirectory(dirname(absolute)).pipe(
        Effect.map((entries) =>
          entries
            .filter((entry) => {
              const candidate = entry.toLowerCase()
              return candidate.includes(base) || base.includes(candidate)
            })
            .map((entry) => join(dirname(input), entry))
            .slice(0, 3),
        ),
        Effect.orElseSucceed(() => [] as string[]),
      )
      const message =
        suggestions.length === 0
          ? `File not found: ${input}`
          : `File not found: ${input}\n\nDid you mean one of these?\n${suggestions.join("\n")}`
      return yield* new ToolFailure({ message })
    })
  }),
}

export const toModelContent = (path: string, offset: number | undefined, output: typeof Output.Type) => {
  if (output.type === "file" && output.encoding === "base64")
    return [
      { type: "text", text: output.mime === "application/pdf" ? "PDF read successfully" : "Image read successfully" },
      {
        type: "file",
        uri: `data:${output.mime};base64,${output.content}`,
        mime: output.mime,
        name: path,
      },
    ] as const

  if (output.type === "list-page") {
    const start = offset ?? 1
    const content = [
      output.entries.length === 0
        ? `Read directory ${path}, 0 entries`
        : `Read directory ${path}, entries ${start}-${start + output.entries.length - 1}`,
    ]
    output.entries.forEach((entry) => content.push(entry.path))
    if (output.truncated && output.next !== undefined)
      content.push(`[Output truncated. Continue reading with offset: ${output.next}]`)
    return content.join("\n")
  }

  const start = output.type === "text-page" ? output.offset : 1
  const lines = output.content === "" ? [] : output.content.replace(/\n$/, "").split("\n")
  const content = [
    lines.length === 0 ? `Read file ${path}, 0 lines` : `Read file ${path}, lines ${start}-${start + lines.length - 1}`,
  ]
  lines.forEach((line, index) => content.push(`${start + index}: ${line}`))
  if (output.type === "text-page" && output.truncated && output.next !== undefined)
    content.push(`[Output truncated. Continue reading with offset: ${output.next}]`)
  return content.join("\n")
}
