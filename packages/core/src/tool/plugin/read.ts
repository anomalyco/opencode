export * as ReadTool from "./read.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import path, { basename, dirname, extname, isAbsolute, join, relative } from "path"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { FileAccess } from "../../file-access.js"
import { InstructionDiscovery } from "../../instruction-discovery.js"
import { Permission } from "../../permission.js"
import { SessionInstructions } from "../../session/instructions.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"
import { ReadToolFileSystem } from "../read-filesystem.js"
import { Environment } from "../../environment/index.js"

export const name = "read"
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
type Missing = { input: string; requested: FileAccess.Target; context: FileAccess.Invocation }

const description = (codemode: boolean) =>
  codemode
    ? [
        "Read a file or directory: text, images, and PDFs.",
        "An image or PDF is attached to the execute result even if the program doesn't return it.",
        `A call returns one page, at most ${ReadToolFileSystem.MAX_READ_LINES} lines or ${ReadToolFileSystem.MAX_READ_BYTES / 1024} KB, and \`next\` is where the following page starts.`,
      ].join(" ")
    : [
        "Read the contents of a file or directory. Supports text files, images, and PDFs.",
        "Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line.",
        "Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
      ].join(" ")

export const Plugin = {
  id: "opencode.tool.read",
  effect: Effect.fn("ReadTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const skills = yield* Skill.Service
    const sessionInstructions = yield* SessionInstructions.Service
    const fs = yield* FSUtil.Service
    const environment = yield* Environment.Service
    const currentWorkingDirectory = yield* Environment.workingDirectoryResolver
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service
    const discovery = yield* InstructionDiscovery.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: flags.resolve(loaded.entries).full_codemode.enabled
            ? { codemode: { pinned: true, description: description(true) } }
            : { codemode: false },
          description: description(false),
          input: Input,
          output: ReadToolFileSystem.Output,
          execute: (input, context) => {
            return Effect.gen(function* () {
              const workingDirectory = yield* currentWorkingDirectory
              if (input.limit === 0) return yield* new ToolFailure({ message: "Limit must be a positive integer" })
              if (Skill.isUri(input.path)) {
                const parsed = Skill.parseAddress(input.path)
                if (!parsed) return yield* new ToolFailure({ message: `File not found: ${input.path}` })
                const id = parsed.id
                const skill = yield* skills.get(id)
                if (!skill || Skill.locate(skill)._tag !== "virtual")
                  return yield* new ToolFailure({ message: `File not found: ${input.path}` })
                const files = [Skill.manifest, ...((yield* skills.files(id)) ?? [])]
                yield* permission.assert({
                  action: "skill",
                  resources: [skill.id],
                  save: [skill.id],
                  ...Permission.invocation(context),
                })
                yield* permission.assert({
                  action: "read",
                  resources: [parsed.uri],
                  save: ["*"],
                  ...Permission.invocation(context),
                })
                const virtualFs = Environment.makeFiles(Environment.makeMemoryDriver())
                // Only the requested file is loaded. The rest stay empty, which is enough for directory listings.
                yield* Effect.forEach(
                  files,
                  (file) =>
                    (file === parsed.file ? skills.read(id, file) : Effect.succeed(new Uint8Array())).pipe(
                      Effect.mapError(
                        (error) =>
                          new ToolFailure({
                            message:
                              error._tag === "Skill.LoadError"
                                ? `Unable to read ${input.path}: ${error.message}`
                                : `File not found: ${input.path}`,
                          }),
                      ),
                      Effect.flatMap((bytes) => virtualFs.write(AbsolutePath.make(`/${file}`), bytes)),
                    ),
                  { discard: true },
                )
                const output = yield* ReadToolFileSystem.read(
                  virtualFs,
                  AbsolutePath.make(`/${parsed.file ?? ""}`),
                  input.path,
                  {
                    offset: input.offset,
                    limit: input.limit,
                  },
                ).pipe(
                  Effect.catchIf(
                    (error) => error instanceof Environment.NotFound,
                    () => Effect.fail(new ToolFailure({ message: `File not found: ${input.path}` })),
                  ),
                )
                return { output, path: input.path }
              }

              const read = (target: FileAccess.Target) =>
                ReadToolFileSystem.read(target.environment.files, target.absolute, target.resource, {
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
                      const alternate = yield* alternatePath(requested).pipe(Effect.orElseSucceed(() => undefined))
                      if (!alternate) return yield* missing({ input: input.path, requested, context })
                      const target = yield* access.authorizeRead(alternate, context, { siblingOf: requested })
                      const content = yield* read(target).pipe(
                        Effect.catchIf(
                          (error) => error instanceof Environment.NotFound,
                          () => missing({ input: input.path, requested, context }),
                        ),
                      )
                      if (content.type === "directory") return yield* missing({ input: input.path, requested, context })
                      return {
                        content,
                        target,
                        path: join(dirname(input.path), basename(alternate)),
                      }
                    }),
                ),
              )
              // After a successful read, discover nearby AGENTS.md (or CLAUDE.md) walking up to the Location
              // root exclusive and inject them as durable synthetic instructions. For a
              // directory listing the walk starts at the directory itself (so its own AGENTS.md
              // is discovered); for a file it starts at the file's dirname. External reads are
              // skipped, and discovery failures never fail the read.
              yield* Effect.gen(function* () {
                if (result.target.externalDirectory !== undefined) return
                // Discovery walks this server's files, so it follows only a target on the Location's own environment.
                // A cwd on a paired machine brings its instructions with it in a later change.
                if (result.target.environment.id !== environment.id) return
                const resolved = yield* fs.resolve(result.target.absolute)
                const root = yield* fs.resolve(workingDirectory.absolute)
                // The Location and its ancestors are already supplied by initial instructions,
                // even when an upward walk from elsewhere in the project cannot reach root.
                const discovered = yield* fs.up({
                  targets: InstructionDiscovery.filenames(discovery),
                  start: result.content.type === "directory" ? resolved : dirname(resolved),
                  stop: root,
                  type: "file",
                })
                const candidates = (yield* Effect.forEach(
                  InstructionDiscovery.preferAgents(discovered),
                  fs.resolve,
                )).filter((file) => !FSUtil.contains(dirname(file), root) && file !== resolved)
                if (candidates.length === 0) return
                yield* sessionInstructions.load({ sessionID: context.sessionID, paths: candidates })
              }).pipe(
                Effect.catch(() => Effect.void),
                Effect.catchDefect(() => Effect.void),
              )
              return { output: result.content, path: result.path }
            }).pipe(
              Effect.map((result) => ({
                output: toOutput(result.output),
                content: toModelContent(result.path, input.offset, result.output),
                metadata: { truncated: result.output.type !== "media" && result.output.next !== undefined },
              })),
              Effect.mapError((error) => {
                if (error instanceof ToolFailure) return error
                const message =
                  error instanceof ReadToolFileSystem.BinaryFileError ||
                  error instanceof ReadToolFileSystem.MediaIngestLimitError ||
                  error instanceof ReadToolFileSystem.PathKindError ||
                  error instanceof ReadToolFileSystem.DirectoryOffsetError
                    ? error.message
                    : `Unable to read ${input.path}`
                return new ToolFailure({ message, error })
              }),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    const alternatePath = Effect.fn("ReadTool.alternatePath")(function* (target: FileAccess.Target) {
      const base = canonical(basename(target.absolute))
      const matches = (yield* target.environment.files.list(AbsolutePath.make(dirname(target.absolute)))).filter(
        (entry) => entry.type === "file" && canonical(entry.name) === base,
      )
      if (matches.length !== 1) return
      // The path follows its environment's rules, whatever this server's platform joins with.
      const rules = target.environment.path ?? path
      return rules.join(rules.dirname(target.absolute), matches[0].name)
    })

    // Lists through the requested target's environment, which may be a remote workspace rather than this host.
    const listing = (files: Environment.Files, path: string) =>
      files.list(AbsolutePath.make(path)).pipe(
        Effect.map((entries) => ({ type: "found" as const, names: entries.map((entry) => entry.name) })),
        Effect.catchTag("Environment.NotFound", () => Effect.succeed({ type: "missing" as const })),
        Effect.orElseSucceed(() => ({ type: "unknown" as const })),
      )

    // A path written from the wrong root, such as /Users/me/src/a.ts for a location at /Users/me/repo,
    // usually means <location>/src/a.ts, so check that one path and nothing else.
    const reroot = Effect.fn("ReadTool.reroot")(function* (miss: Missing) {
      const root = (yield* currentWorkingDirectory).absolute
      // A machine's path is not this server's path to reroot, even when the text happens to sit under the Location.
      if (miss.requested.environment.id !== environment.id) return []
      if (FSUtil.contains(root, miss.requested.absolute) || !FSUtil.contains(dirname(root), miss.requested.absolute))
        return []
      const target = yield* access.resolve({ path: join(root, relative(dirname(root), miss.requested.absolute)) })
      if (!(yield* Environment.exists(target.environment.files, target.absolute))) return []
      const readable = yield* permission.allows({
        action: "read",
        resources: [target.resource],
        save: ["*"],
        ...Permission.invocation(miss.context),
      })
      if (!readable) return []
      return [isAbsolute(FSUtil.expandHome(miss.input, Global.Path.home)) ? target.absolute : target.resource]
    })

    const didYouMean = (suggestions: string[]) =>
      suggestions.length === 0 ? [] : [`Did you mean one of these?\n${suggestions.slice(0, 3).join("\n")}`]

    // A missing folder usually means a removed worktree, a moved directory, or a relative path
    // resolved from the wrong place, so name the first missing folder and its nearest existing parent.
    const missingFolder = Effect.fn("ReadTool.missingFolder")(function* (
      miss: Missing,
      folder: string,
      moved: string[],
    ) {
      let child = folder
      let parent = dirname(folder)
      while (parent !== child) {
        const found = yield* listing(miss.requested.environment.files, parent)
        if (found.type === "unknown") break
        if (found.type === "found") {
          const suggestions = [...moved, ...similar(found.names, basename(child)).map((entry) => join(parent, entry))]
          const message = [
            `File not found: ${miss.input}`,
            `The folder ${child} does not exist. The nearest folder that does is ${parent}.`,
            ...didYouMean(suggestions),
          ].join("\n\n")
          return yield* new ToolFailure({ message })
        }
        child = parent
        parent = dirname(parent)
      }
      return yield* new ToolFailure({
        message: [`File not found: ${miss.input}`, ...didYouMean(moved)].join("\n\n"),
      })
    })

    const missing = Effect.fn("ReadTool.missing")(function* (miss: Missing) {
      const moved = yield* reroot(miss).pipe(Effect.orElseSucceed(() => []))
      const folder = dirname(miss.requested.absolute)
      const found = yield* listing(miss.requested.environment.files, folder)
      if (found.type === "missing") return yield* missingFolder(miss, folder, moved)
      const suggestions = [
        ...moved,
        ...(found.type === "found"
          ? similar(found.names, basename(miss.input)).map((entry) => join(dirname(miss.input), entry))
          : []),
      ]
      return yield* new ToolFailure({
        message: [`File not found: ${miss.input}`, ...didYouMean(suggestions)].join("\n\n"),
      })
    })
  }),
}

// Ranks a folder's entries against a missing name: same name ignoring case, then same stem with
// another extension, then one containing the other, then a typo in the stem.
const similar = (names: readonly string[], requested: string) => {
  const name = requested.toLowerCase()
  const wanted = stem(name)
  const typos = wanted.length < 3 ? 0 : wanted.length < 5 ? 1 : 2
  const tier = (candidate: string) => {
    if (candidate === name) return 1
    // Names that only differ in look-alike characters are what alternatePath recovers or deliberately skips.
    if (canonical(candidate) === canonical(name)) return
    const found = stem(candidate)
    if (found === wanted) return 2
    if (
      Math.min(found.length, wanted.length) >= 3 &&
      (candidate.includes(name) || name.includes(candidate) || found.includes(wanted) || wanted.includes(found))
    )
      return 3
    // Folders can be huge, so skip the distance when the lengths alone rule out a typo.
    if (typos > 0 && Math.abs(found.length - wanted.length) <= typos && editDistance(found, wanted) <= typos) return 4
  }
  return names
    .filter((entry) => entry !== requested)
    .flatMap((entry) => {
      const rank = tier(entry.toLowerCase())
      return rank === undefined ? [] : [{ entry, rank, distance: editDistance(entry.toLowerCase(), name) }]
    })
    .sort((a, b) => a.rank - b.rank || a.distance - b.distance || a.entry.localeCompare(b.entry))
    .slice(0, 3)
    .map((match) => match.entry)
}

const canonical = (name: string) =>
  name
    .normalize("NFC")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")

const stem = (name: string) => name.slice(0, name.length - extname(name).length) || name

const editDistance = (a: string, b: string) => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length]
}

const toOutput = (
  output: ReadToolFileSystem.TextPage | ReadToolFileSystem.DirectoryContent | ReadToolFileSystem.Media,
): ReadToolFileSystem.Output => {
  if (output.type === "media") return { type: output.type, uri: output.uri, mime: output.mime, name: output.name }
  if (output.type === "directory") return output
  const { lineCount: _, ...text } = output
  return text
}

export const toModelContent = (
  path: string,
  offset: number | undefined,
  output: ReadToolFileSystem.TextPage | ReadToolFileSystem.DirectoryContent | ReadToolFileSystem.Media,
) => {
  if (output.type === "media")
    return [
      { type: "text", text: output.mime === "application/pdf" ? "PDF read successfully" : "Image read successfully" },
      {
        type: "file",
        uri: `data:${output.mime};base64,${Buffer.from(output.bytes).toString("base64")}`,
        mime: output.mime,
        name: path,
      },
    ] as const

  if (output.type === "directory") {
    const start = offset || 1
    const content = [
      output.entries.length === 0
        ? `Read directory ${path}, 0 entries`
        : `Read directory ${path}, entries ${start}-${start + output.entries.length - 1}`,
      ...output.entries,
    ]
    if (output.next !== undefined) content.push(`[Output truncated. Continue reading with offset: ${output.next}]`)
    return content.join("\n")
  }

  const start = output.offset
  // Whole-file content keeps its final newline and a selected trailing blank line is an empty last
  // line, so the line count decides which pieces are lines.
  const lines = output.lineCount === 0 ? [] : output.content.split("\n").slice(0, output.lineCount)
  // A page that starts before the requested offset is the file's tail, returned for an offset past the end.
  const total = start + lines.length - 1
  const pastEnd = offset !== undefined && start < offset
  const content = [
    (lines.length === 0 ? `Read file ${path}, 0 lines` : `Read file ${path}, lines ${start}-${total}`) +
      (pastEnd ? ` (offset ${offset} is past the end; the file has ${total} ${total === 1 ? "line" : "lines"})` : ""),
  ]
  lines.forEach((line, index) => content.push(`${start + index}: ${line}`))
  if (output.next !== undefined) content.push(`[Output truncated. Continue reading with offset: ${output.next}]`)
  return content.join("\n")
}
