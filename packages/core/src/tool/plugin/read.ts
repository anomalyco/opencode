export * as ReadTool from "./read.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { basename, dirname, extname, isAbsolute, join } from "path"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Location } from "../../location.js"
import { Ripgrep } from "../../ripgrep.js"
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
    description: "Maximum lines or directory entries to read (up to 2000)",
  }),
})
export const Input = LocationInput
type Missing = { input: string; requested: FileAccess.Target; context: FileAccess.Invocation }
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
    const ripgrep = yield* Ripgrep.Service

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
                      if (!alternate) return yield* missing({ input: input.path, requested, context })
                      const target = yield* access.authorizeRead(alternate, context, { siblingOf: requested })
                      const content = yield* read(target).pipe(
                        Effect.catchIf(
                          (error) => error instanceof Environment.NotFound,
                          () => missing({ input: input.path, requested, context }),
                        ),
                      )
                      if (content.type === "list-page") return yield* missing({ input: input.path, requested, context })
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
          if (candidate.includes(base) || base.includes(candidate)) return true
          // Names that only differ in look-alike characters are what alternatePath recovers or deliberately skips.
          if (canonical(candidate) === canonical(base)) return false
          const wanted = stem(base)
          return editDistance(stem(candidate), wanted) <= (wanted.length < 3 ? 0 : wanted.length < 5 ? 1 : 2)
        })
        .slice(0, 3)
    }

    // Readable same-name files elsewhere in the repository, nearest first. A timeout kills the ripgrep child.
    const elsewhere = Effect.fn("ReadTool.elsewhere")(function* ({ input, requested, context }: Missing) {
      if (!location.vcs || !FSUtil.contains(location.directory, requested.absolute)) return []
      const name = basename(requested.absolute)
      const segments = requested.resource.split("/")
      const shared = (path: string) => path.split("/").findIndex((part, offset) => part !== segments[offset])
      // Glob metacharacters become single-character wildcards; the exact name is checked below.
      const pattern = `**/${name.replace(/[*?[\]{}\\!]/g, "?")}`
      const found = yield* ripgrep.glob({ cwd: location.directory, pattern, limit: ELSEWHERE_LIMIT }).pipe(
        Effect.timeout("2 seconds"),
        Effect.orElseSucceed(() => []),
      )
      // ripgrep returns files in walk order, so a capped list can miss the nearest copy of a common name.
      if (found.length >= ELSEWHERE_LIMIT) return []
      const candidates = found
        .map((entry) => entry.path)
        .filter((path) => path !== requested.resource && path.split("/").at(-1) === name)
        .sort((a, b) => shared(b) - shared(a))
      const readable = yield* Effect.filter(candidates, (path) =>
        permission.allows({ action: "read", resources: [path], save: ["*"], ...Permission.invocation(context) }),
      )
      const absolute = isAbsolute(input) || input.startsWith("~/")
      return readable.slice(0, 3).map((path) => (absolute ? join(location.directory, path) : path))
    })

    const didYouMean = (suggestions: string[]) =>
      suggestions.length === 0 ? [] : [`Did you mean one of these?\n${suggestions.slice(0, 3).join("\n")}`]

    // A missing folder usually means a removed worktree, a moved directory, or a relative path
    // resolved from the wrong place, so name the first missing folder and its nearest existing parent.
    const missingFolder = Effect.fn("ReadTool.missingFolder")(function* (miss: Missing) {
      const { input } = miss
      let child = dirname(miss.requested.absolute)
      let parent = dirname(child)
      while (parent !== child) {
        const found = yield* listing(parent)
        if (found.type === "unknown") break
        if (found.type === "found") {
          const suggestions = [
            ...(yield* elsewhere(miss)),
            ...similar(found.names, basename(child)).map((entry) => join(parent, entry)),
          ]
          const message = [
            `File not found: ${input}`,
            `The folder ${child} does not exist. The nearest folder that does is ${parent}.`,
            ...didYouMean(suggestions),
          ].join("\n\n")
          return yield* new ToolFailure({ message })
        }
        child = parent
        parent = dirname(parent)
      }
      return yield* new ToolFailure({ message: `File not found: ${input}` })
    })

    const missing = Effect.fn("ReadTool.missing")(function* (miss: Missing) {
      const { input } = miss
      const found = yield* listing(dirname(miss.requested.absolute))
      if (found.type === "missing") return yield* missingFolder(miss)
      const suggestions =
        found.type === "found" ? similar(found.names, basename(input)).map((entry) => join(dirname(input), entry)) : []
      if (suggestions.length < 3) suggestions.push(...(yield* elsewhere(miss)))
      return yield* new ToolFailure({ message: [`File not found: ${input}`, ...didYouMean(suggestions)].join("\n\n") })
    })
  }),
}

const ELSEWHERE_LIMIT = 200

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
  // A page that starts before the requested offset is the file's tail, returned for an offset past the end.
  const total = start + lines.length - 1
  const pastEnd = output.type === "text-page" && offset !== undefined && start < offset
  const content = [
    (lines.length === 0 ? `Read file ${path}, 0 lines` : `Read file ${path}, lines ${start}-${total}`) +
      (pastEnd ? ` (offset ${offset} is past the end; the file has ${total} ${total === 1 ? "line" : "lines"})` : ""),
  ]
  lines.forEach((line, index) => content.push(`${start + index}: ${line}`))
  if (output.type === "text-page" && output.truncated && output.next !== undefined)
    content.push(`[Output truncated. Continue reading with offset: ${output.next}]`)
  return content.join("\n")
}
