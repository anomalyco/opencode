export * as ReadTool from "./read.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { basename, dirname, join } from "path"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Location } from "../../location.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { SessionInstructions } from "../../session/instructions.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"
import { SkillDiscovery } from "../../skill/discovery.js"
import { ReadToolFileSystem } from "../read-filesystem.js"
import { Environment } from "../../environment/index.js"

export const name = "read"
const FILENAME = "AGENTS.md"
const LocationInput = Schema.Struct({
  path: Schema.String.annotate({ description: "File or directory to read" }),
  offset: ReadToolFileSystem.PageInput.fields.offset.annotate({
    description: "The line or directory entry to start reading from (1-based)",
  }),
  limit: ReadToolFileSystem.PageInput.fields.limit.annotate({
    description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)",
  }),
})
export const Input = LocationInput
const Output = Schema.Union([ReadToolFileSystem.FileContent, ReadToolFileSystem.TextPage, ReadToolFileSystem.ListPage])

export const Plugin = {
  id: "opencode.tool.read",
  effect: Effect.fn("ReadTool.Plugin")(function* (ctx: Context) {
    const reader = yield* ReadToolFileSystem.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const skills = yield* Skill.Service
    const sessionInstructions = yield* SessionInstructions.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
          input: Input,
          output: Output,
          execute: (input, context) => {
            return Effect.gen(function* () {
              if (Skill.isUri(input.path)) {
                const parsed = parseSkillUri(input.path)
                if (!parsed) return yield* new ToolFailure({ message: `File not found: ${input.path}` })
                const id = Skill.ID.make(parsed.id)
                const skill = yield* skills.get(id)
                if (!skill || !Skill.isUri(skill.path))
                  return yield* new ToolFailure({ message: `File not found: ${input.path}` })
                const extra = yield* skills.files(id)
                const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
                yield* permission.assert({
                  action: "skill",
                  resources: [skill.id],
                  save: [skill.id],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                yield* permission.assert({
                  action: "read",
                  resources: [parsed.uri],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                const virtualFs = Environment.makeFiles(Environment.makeMemoryDriver())
                const encoder = new TextEncoder()
                yield* virtualFs.write(AbsolutePath.make("/SKILL.md"), encoder.encode(skill.content))
                yield* Effect.forEach(
                  extra ? Array.from(extra) : [],
                  ([rel, text]) => virtualFs.write(AbsolutePath.make(`/${rel}`), encoder.encode(text)),
                  { discard: true },
                )
                const output = yield* ReadToolFileSystem.read(virtualFs, AbsolutePath.make(parsed.target), input.path, {
                  offset: input.offset,
                  limit: input.limit,
                }).pipe(
                  Effect.catchIf(
                    (error) => error instanceof Environment.NotFound,
                    () => Effect.fail(new ToolFailure({ message: `File not found: ${input.path}` })),
                  ),
                )
                return { output, path: input.path }
              }

              const read = (target: FileAccess.Target) =>
                reader.read(target.absolute, target.resource, {
                  offset: input.offset,
                  limit: input.limit,
                })

              const requested = yield* access.authorizeRead(input.path, context)
              const result = yield* read(requested).pipe(
                Effect.map((content) => ({ content, target: requested, path: input.path })),
                Effect.catchIf(
                  (error) => error instanceof Environment.NotFound,
                  () =>
                    Effect.gen(function* () {
                      const alternate = yield* alternatePath(requested.absolute).pipe(
                        Effect.orElseSucceed(() => undefined),
                      )
                      if (!alternate) return yield* missing(input.path, requested.absolute)
                      const target = yield* access.authorizeRead(alternate, context, { siblingOf: requested })
                      const content = yield* read(target).pipe(
                        Effect.catchIf(
                          (error) => error instanceof Environment.NotFound,
                          () => missing(input.path, requested.absolute),
                        ),
                      )
                      if (content.type === "list-page") return yield* missing(input.path, requested.absolute)
                      return {
                        content,
                        target,
                        path: join(dirname(input.path), basename(alternate)),
                      }
                    }),
                ),
              )
              // After a successful read, discover nearby AGENTS.md walking up to the Location
              // root exclusive and inject them as durable synthetic instructions. For a
              // directory listing the walk starts at the directory itself (so its own AGENTS.md
              // is discovered); for a file it starts at the file's dirname. External reads are
              // skipped, and discovery failures never fail the read.
              yield* Effect.gen(function* () {
                if (result.target.externalDirectory !== undefined) return
                const resolved = yield* fs.resolve(result.target.absolute)
                const root = yield* fs.resolve(location.directory)
                // The Location and its ancestors are already supplied by initial instructions,
                // even when an upward walk from elsewhere in the project cannot reach root.
                const discovered = yield* fs.up({
                  targets: [FILENAME],
                  start: result.content.type === "list-page" ? resolved : dirname(resolved),
                  stop: root,
                  type: "file",
                })
                const candidates = (yield* Effect.forEach(discovered, fs.resolve)).filter(
                  (file) => !FSUtil.contains(dirname(file), root) && file !== resolved,
                )
                if (candidates.length === 0) return
                yield* sessionInstructions.load({ sessionID: context.sessionID, paths: candidates })
              }).pipe(
                Effect.catch(() => Effect.void),
                Effect.catchDefect(() => Effect.void),
              )
              return { output: result.content, path: result.path }
            }).pipe(
              Effect.map((result) => ({
                output: result.output,
                content: toModelContent(result.path, input.offset, result.output),
                metadata: { truncated: result.output.type === "file" ? false : result.output.truncated },
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

    const alternatePath = Effect.fn("ReadTool.alternatePath")(function* (absolute: string) {
      const canonical = (name: string) =>
        name
          .normalize("NFC")
          .replace(/[\u00a0\u202f]/g, " ")
          .replace(/[\u2018\u2019]/g, "'")
      const base = canonical(basename(absolute))
      const matches = (yield* reader.list(AbsolutePath.make(dirname(absolute)))).filter(
        (entry) => entry.type === "file" && canonical(entry.name) === base,
      )
      if (matches.length !== 1) return
      return join(dirname(absolute), matches[0].name)
    })

    // Lists through the session's environment, which may be a remote workspace rather than this host.
    const listing = (path: string) =>
      reader.list(AbsolutePath.make(path)).pipe(
        Effect.map((entries) => ({ type: "found" as const, names: entries.map((entry) => entry.name) })),
        Effect.catchTag("Environment.NotFound", () => Effect.succeed({ type: "missing" as const })),
        Effect.orElseSucceed(() => ({ type: "unknown" as const })),
      )

    const similar = (names: readonly string[], name: string) => {
      const base = name.toLowerCase()
      return names
        .filter((entry) => {
          const candidate = entry.toLowerCase()
          return candidate.includes(base) || base.includes(candidate)
        })
        .slice(0, 3)
    }

    // A missing folder usually means a removed worktree, a moved directory, or a relative path
    // resolved from the wrong place, so name the first missing folder and its nearest existing parent.
    const missingFolder = Effect.fn("ReadTool.missingFolder")(function* (input: string, folder: string) {
      let child = folder
      let parent = dirname(folder)
      while (parent !== child) {
        const found = yield* listing(parent)
        if (found.type === "unknown") break
        if (found.type === "found") {
          const suggestions = similar(found.names, basename(child)).map((entry) => join(parent, entry))
          const message = [
            `File not found: ${input}`,
            `The folder ${child} does not exist. The nearest folder that does is ${parent}.`,
            ...(suggestions.length === 0 ? [] : [`Did you mean one of these?\n${suggestions.join("\n")}`]),
          ].join("\n\n")
          return yield* new ToolFailure({ message })
        }
        child = parent
        parent = dirname(parent)
      }
      return yield* new ToolFailure({ message: `File not found: ${input}` })
    })

    const missing = Effect.fn("ReadTool.missing")(function* (input: string, absolute: string) {
      const folder = dirname(absolute)
      const found = yield* listing(folder)
      if (found.type === "missing") return yield* missingFolder(input, folder)
      const suggestions =
        found.type === "found" ? similar(found.names, basename(input)).map((entry) => join(dirname(input), entry)) : []
      const message =
        suggestions.length === 0
          ? `File not found: ${input}`
          : `File not found: ${input}\n\nDid you mean one of these?\n${suggestions.join("\n")}`
      return yield* new ToolFailure({ message })
    })
  }),
}

function parseSkillUri(value: string) {
  const trimmed = value.slice("skill://".length).replace(/\/+$/, "")
  const slash = trimmed.indexOf("/")
  const id = slash === -1 ? trimmed : trimmed.slice(0, slash)
  const rest = slash === -1 ? "" : trimmed.slice(slash + 1)
  if (!SkillDiscovery.isSafeSegment(id)) return undefined
  if (rest !== "" && !rest.split("/").every(SkillDiscovery.isSafeSegment)) return undefined
  // Permission checks use the canonical URI, so `skill://id/file/` can't slip past a rule for `skill://id/file`.
  return { id, target: rest === "" ? "/" : `/${rest}`, uri: Skill.uri(id, rest || undefined) }
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
    const start = offset || 1
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
  // Pages already join selected lines; a trailing newline represents a selected blank line.
  const text = output.type === "file" ? output.content.replace(/\n$/, "") : output.content
  const lines = output.content === "" ? [] : text.split("\n")
  const content = [
    lines.length === 0 ? `Read file ${path}, 0 lines` : `Read file ${path}, lines ${start}-${start + lines.length - 1}`,
  ]
  lines.forEach((line, index) => content.push(`${start + index}: ${line}`))
  if (output.type === "text-page" && output.truncated && output.next !== undefined)
    content.push(`[Output truncated. Continue reading with offset: ${output.next}]`)
  return content.join("\n")
}
