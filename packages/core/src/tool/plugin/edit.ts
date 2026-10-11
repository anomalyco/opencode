/**
 * Model-facing exact-edit leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as EditTool from "./edit.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { FileDiff } from "@opencode/schema/file-diff"
import { Bom } from "@opencode/util/bom"
import { Effect, Schema } from "effect"
import { Environment } from "../../environment/index.js"
import { FileMutation } from "../../file-mutation.js"
import { Formatter } from "../../formatter.js"
import { Location } from "../../location.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { fileDiff } from "./file-diff.js"

export const name = "edit"

export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "File to edit",
  }),
  oldString: Schema.String.annotate({ description: "Exact text to find and replace" }),
  newString: Schema.String.annotate({ description: "Text to replace oldString with (must differ from oldString)" }),
  replaceAll: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Whether to replace every occurrence of oldString. When false, oldString must match exactly once. Defaults to false.",
  }),
})

export const Output = Schema.Struct({
  files: Schema.Array(FileDiff.Info),
  replacements: Schema.Number,
})
export type Output = typeof Output.Type

const crlf = "\r\n"

interface Match {
  readonly start: number
  readonly end: number
}

const normalizeForMatch = (value: string) =>
  value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")

const findOccurrences = (content: string, search: string) => {
  const result: Match[] = []
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    result.push({ start: offset, end: offset + search.length })
    offset += search.length
  }
  return result
}

const findLineOccurrences = (content: string, search: string) => {
  const trailingNewline = search.endsWith("\n")
  const expected = search.split("\n")
  if (trailingNewline) expected.pop()
  const lines = [...content.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0] !== "")
    .map((match) => {
      const newline = match[0].endsWith("\n")
      const text = newline ? match[0].slice(0, -1) : match[0]
      return {
        start: match.index,
        end: match.index + match[0].length,
        text,
        contentEnd: match.index + text.length - (text.endsWith("\r") ? 1 : 0),
        newline,
      }
    })
  const candidates = lines.flatMap((line, index) => {
    const actual = lines.slice(index, index + expected.length)
    if (actual.length !== expected.length) return []
    if (
      !actual.every(
        (item, lineIndex) =>
          normalizeForMatch(item.text.trimEnd()) === normalizeForMatch(expected[lineIndex].trimEnd()),
      )
    )
      return []
    const last = actual.at(-1)!
    if (trailingNewline && !last.newline) return []
    return [{ start: line.start, end: trailingNewline ? last.end : last.contentEnd }]
  })
  return candidates.reduce<Match[]>((result, candidate) => {
    if (result.some((match) => match.end > candidate.start && match.start < candidate.end)) return result
    result.push(candidate)
    return result
  }, [])
}

/** The dominant line ending in text, or fallback when there is none. */
const lineEnding = (text: string, fallback: string) => {
  const crlfCount = text.split(crlf).length - 1
  const lfCount = text.split("\n").length - 1 - crlfCount
  if (crlfCount === lfCount) return fallback
  return crlfCount > lfCount ? crlf : "\n"
}

/**
 * Joins the replacement's lines with line endings taken from the matched source region. A replacement line that
 * keeps a region line (longest common subsequence, compared like the trailing-whitespace tier) reuses that line's
 * ending; a line that changes in place reuses the ending of the line it replaces; only lines beyond those take
 * `fallback`. Unchanged context inside a match therefore keeps its bytes even in a mixed-ending file.
 */
const withRegionEndings = (region: string, replacement: string, fallback: string) => {
  const before = region.split(/\r?\n/)
  const endings = [...region.matchAll(/\r?\n/g)].map((match) => match[0])
  const after = replacement.split("\n")
  const key = (line: string) => normalizeForMatch(line.trimEnd())
  const source = alignLines(before.map(key), after.map(key))
  return after.map((line, index) => (index === after.length - 1 ? line : line + (endings[source[index]!] ?? fallback))).join("")
}

/**
 * For each line of `after`, the index of the `before` line it keeps (longest common subsequence) or, between kept
 * lines, the line it takes the place of; undefined for lines with no counterpart.
 */
const alignLines = (before: string[], after: string[]) => {
  const width = after.length + 1
  const table = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  const result: (number | undefined)[] = []
  const gap = { before: [] as number[], after: [] as number[] }
  const flush = () => {
    gap.after.forEach((j, k) => (result[j] = gap.before[k]))
    gap.before = []
    gap.after = []
  }
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      flush()
      result[j++] = i++
      continue
    }
    if (table[(i + 1) * width + j] >= table[i * width + j + 1]) gap.before.push(i++)
    else gap.after.push(j++)
  }
  while (i < before.length) gap.before.push(i++)
  while (j < after.length) gap.after.push(j++)
  flush()
  return result
}

/**
 * Matches against the LF view Read shows the model, then maps offsets back to the source, so CRLF and mixed line
 * endings neither block matches nor leak into untouched regions.
 */
const matchView = (source: string, oldString: string, newString: string) => {
  const view = source.replaceAll(crlf, "\n")
  const removed = [...source.matchAll(/\r\n/g)].map((match, index) => match.index - index)
  const fileEnding = lineEnding(source, "\n")
  const search = oldString.replaceAll(crlf, "\n")
  const replacement = newString.replaceAll(crlf, "\n")
  const exact = findOccurrences(view, search)
  // These one-to-one mappings preserve offsets into the LF view.
  const unicode = exact.length > 0 ? [] : findOccurrences(normalizeForMatch(view), normalizeForMatch(search))
  const trailing = exact.length > 0 || unicode.length > 0 ? [] : findLineOccurrences(view, search)
  return {
    matches: (exact.length > 0 ? exact : unicode.length > 0 ? unicode : trailing).map((match) => ({
      start: match.start + countBefore(removed, match.start),
      end: match.end + countBefore(removed, match.end),
    })),
    replace: (match: Match) => {
      const region = source.slice(match.start, match.end)
      return withRegionEndings(region, replacement, lineEnding(region, fileEnding))
    },
  }
}

/** Number of sorted positions strictly before offset. */
const countBefore = (positions: number[], offset: number) => {
  let low = 0
  let high = positions.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (positions[middle] < offset) low = middle + 1
    else high = middle
  }
  return low
}

/** Deferred edit behavior and UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after LSP runtime exists.

export const Plugin = {
  id: "opencode.tool.edit",
  effect: Effect.fn("EditTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const environment = yield* Environment.Service
    const formatter = yield* Formatter.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          description:
            "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. Write line breaks as \\n; the file's existing CRLF or LF line endings are matched and preserved. To change line endings themselves, make oldString and newString differ only in \\r; that edit applies to the exact bytes. If there is no exact match, the edit retries while ignoring typographic quote, dash, and space variants, then trailing whitespace on each line. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",
          input: Input,
          output: Output,
          execute: (input, context) => {
            return Effect.gen(function* () {
              const permissionSource = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              if (input.oldString === input.newString) {
                return yield* new ToolFailure({
                  message: "No changes to apply: oldString and newString are identical.",
                })
              }
              if (input.oldString === "") {
                return yield* new ToolFailure({
                  message: "oldString must not be empty. Use write to create or overwrite a file.",
                })
              }

              const target = yield* access.resolve({ path: input.path, kind: "file" })
              yield* access.authorizeExternal([target], context)

              const original = yield* FileMutation.readText(environment.files, target.absolute).pipe(
                Effect.catchTag("Environment.NotFound", () =>
                  Effect.fail(new ToolFailure({ message: `File not found: ${input.path}` })),
                ),
                Effect.catchTag("Environment.WrongKind", (error) =>
                  error.actual === "directory"
                    ? Effect.fail(new ToolFailure({ message: `Path is a directory, not a file: ${input.path}` }))
                    : Effect.fail(new ToolFailure({ message: `Unable to edit ${input.path}`, error })),
                ),
              )
              const source = original.text
              // Strings that differ only in \r ask to change line endings themselves, so they apply to the exact
              // bytes. Every other edit matches the LF view Read shows the model and keeps the file's endings.
              const endingsOnly = input.oldString.replaceAll("\r", "") === input.newString.replaceAll("\r", "")
              const { matches, replace } = endingsOnly
                ? { matches: findOccurrences(source, input.oldString), replace: () => input.newString }
                : matchView(source, input.oldString, input.newString)
              const replacements = matches.length
              const replaced = (input.replaceAll === true ? matches : matches.slice(0, 1))
                .toReversed()
                .reduce(
                  (content, match) => `${content.slice(0, match.start)}${replace(match)}${content.slice(match.end)}`,
                  source,
                )
              const preview =
                replacements > 0 && (replacements === 1 || input.replaceAll === true)
                  ? fileDiff(target.resource, source, replaced)
                  : undefined
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                metadata: preview ? { files: [preview] } : undefined,
                sessionID: context.sessionID,
                agent: context.agent,
                source: permissionSource,
              })
              if (replacements === 0) {
                return yield* new ToolFailure({
                  message: `Could not find oldString in ${input.path}. It must match exactly, including whitespace and indentation.`,
                })
              }
              if (replacements > 1 && input.replaceAll !== true) {
                return yield* new ToolFailure({
                  message: `Found ${replacements} matches for oldString, but expected exactly one. Add more surrounding context to make oldString unique, or set replaceAll to true to replace every occurrence.`,
                })
              }
              if (replaced === source) {
                return yield* new ToolFailure({
                  message: endingsOnly
                    ? `No changes to apply: ${input.path} already has those line endings.`
                    : `No changes to apply: the edit leaves ${input.path} unchanged. Line endings follow the file; to change them, write \\r explicitly in oldString or newString.`,
                })
              }
              const replacementBom = replaced.startsWith("\uFEFF")
              const result = yield* fileMutation.write({
                target,
                content: Bom.join(replaced, original.bom || replacementBom),
              })
              const bom = original.bom || replacementBom
              const formatted = (yield* formatter.file(target.absolute))
                ? yield* FileMutation.syncTextBom(environment.files, target.absolute, bom)
                : (yield* FileMutation.readText(environment.files, target.absolute)).text
              return {
                files: [fileDiff(result.resource, source, formatted)],
                replacements,
              } satisfies Output
            }).pipe(
              fileMutation.withLock([FileAccess.resolvePath(location.directory, input.path)]),
              Effect.map((output) => ({
                output,
                content: `Edited ${output.files[0]?.file} (${output.replacements} replacement${output.replacements === 1 ? "" : "s"})`,
                metadata: { files: output.files },
              })),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to edit ${input.path}`, error }),
              ),
            )
          },
        }),
      )
      .pipe(Effect.orDie)
  }),
}
