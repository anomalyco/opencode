/**
 * Model-facing exact-edit leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as EditTool from "./edit"

import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { Bom } from "@opencode-ai/util/bom"
import { Effect, Schema } from "effect"
import { FileMutation } from "../../file-mutation"
import { LocationMutation } from "../../location-mutation"
import { Permission } from "../../permission"
import { fileDiff } from "./file-diff"

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
          normalizeForMatch(item.text.trimEnd()) === normalizeForMatch(expected[lineIndex]!.trimEnd()),
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

/** Deferred edit behavior and UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after LSP runtime exists.

export const Plugin = {
  id: "opencode.tool.edit",
  effect: Effect.fn("EditTool.Plugin")(function* (ctx: PluginContext) {
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add({
          name,
          options: { codemode: false, permission: "edit" },
          description:
            "Edit the contents of a file by finding and replacing exact text. When editing text from Read output, preserve the exact indentation (tabs or spaces) and omit the line-number prefix, such as `1: `. Never include the prefix in oldString or newString. The edit fails if oldString is not found. By default, oldString must identify a UNIQUE location. Multiple matches FAIL unless replaceAll is true. Add more surrounding context to disambiguate, or set replaceAll to true to replace every occurrence. Use replaceAll when the change should apply to every occurrence, such as renaming a variable.",
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

              const target = yield* mutation.resolve({ path: input.path, kind: "file" })
              const external = target.externalDirectory
              if (external) {
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: permissionSource,
                })
              }

              const source = yield* files.read(target).pipe(
                Effect.catchTag("FileMutation.NotFoundError", () =>
                  Effect.fail(new ToolFailure({ message: `File not found: ${input.path}` })),
                ),
                Effect.catchTag("FileMutation.NotAFileError", () =>
                  Effect.fail(new ToolFailure({ message: `Path is a directory, not a file: ${input.path}` })),
                ),
              )
              const ending = source.includes(crlf) ? crlf : "\n"
              const oldString = input.oldString.replaceAll(crlf, "\n").replaceAll("\n", ending)
              const newString = input.newString.replaceAll(crlf, "\n").replaceAll("\n", ending)
              const exact = findOccurrences(source, oldString)
              // These one-to-one mappings preserve offsets into the original source.
              const unicode =
                exact.length > 0 ? [] : findOccurrences(normalizeForMatch(source), normalizeForMatch(oldString))
              const trailing = exact.length > 0 || unicode.length > 0 ? [] : findLineOccurrences(source, oldString)
              const matches = exact.length > 0 ? exact : unicode.length > 0 ? unicode : trailing
              const replacements = matches.length
              const replaced = (input.replaceAll === true ? matches : matches.slice(0, 1))
                .toReversed()
                .reduce(
                  (content, match) => `${content.slice(0, match.start)}${newString}${content.slice(match.end)}`,
                  source,
                )
              const content = FileMutation.normalizeText(replaced)
              const preview =
                replacements > 0 && (replacements === 1 || input.replaceAll === true)
                  ? fileDiff(target.resource, source, content)
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
              const result = yield* files.write({ target, content: replaced })
              return {
                files: [fileDiff(result.resource, source, result.content)],
                replacements,
              } satisfies Output
            }).pipe(
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
