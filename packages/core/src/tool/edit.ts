/**
 * Model-facing V2 exact-edit leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval. Named project references
 * are read-oriented and deliberately are not accepted by mutation tools.
 */
export * as EditTool from "./edit"

import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { ToolRegistry } from "./registry"

export const name = "edit"

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "File path to edit. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval. Named project references are read-oriented and are not accepted.",
  }),
  oldString: Schema.String.annotate({ description: "Exact text to replace" }),
  newString: Schema.String.annotate({ description: "Replacement text, which must differ from oldString" }),
  replaceAll: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Replace all exact occurrences of oldString (default false)",
  }),
})

export const Success = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
  replacements: Schema.Number,
})
export type Success = typeof Success.Type

const normalizeLineEndings = (text: string) => text.replaceAll("\r\n", "\n")
const detectLineEnding = (text: string): "\n" | "\r\n" => (text.includes("\r\n") ? "\r\n" : "\n")
const convertToLineEnding = (text: string, ending: "\n" | "\r\n") =>
  ending === "\n" ? normalizeLineEndings(text) : normalizeLineEndings(text).replaceAll("\n", "\r\n")

const splitBom = (text: string) =>
  text.startsWith("\uFEFF") ? { bom: true, text: text.slice(1) } : { bom: false, text }
const joinBom = (text: string, bom: boolean) => (bom ? `\uFEFF${text}` : text)
const decodeUtf8 = (content: Uint8Array) => {
  const bom = content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
  return { bom, content, text: new TextDecoder().decode(bom ? content.slice(3) : content) }
}

const countOccurrences = (content: string, search: string) => {
  if (search === "") return content.length + 1
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

const previewLines = (value: string, prefix: "+" | "-") => {
  const lines = normalizeLineEndings(value).split("\n")
  const shown = lines.slice(0, 6).map((line) => `${prefix}${line.length > 240 ? `${line.slice(0, 240)}...` : line}`)
  if (lines.length > shown.length) shown.push(`${prefix}...`)
  return shown
}

export const toModelOutput = (output: Success, oldString: string, newString: string) =>
  [
    `Edited file successfully: ${output.resource}`,
    `Replacements: ${output.replacements}`,
    "```diff",
    ...previewLines(oldString, "-"),
    ...previewLines(newString, "+"),
    "```",
  ].join("\n")

const definition = Tool.make({
  description:
    "Replace exact text in one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval. Named project references are read-oriented and are not accepted.",
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ parameters, output }) => [
    toolText({ type: "text", text: toModelOutput(output, parameters.oldString, parameters.newString) }),
  ],
})

/** Deferred V2 edit behavior and UX integrations remain visible at the model-facing seam. */
// TODO: Port V1 fuzzy correction strategies only after exact-edit behavior is established: line-trimmed matching, block-anchor fallback, indentation correction, and similarity-threshold review.
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after V2 LSP runtime exists.

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, assertPermission }) => {
          const unableToEdit = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(
              Effect.catchCause((cause) => {
                const error = Cause.squash(cause)
                return Effect.fail(
                  error instanceof FileMutation.StaleContentError
                    ? new ToolFailure({
                        message: "File changed after permission approval. Read it again before editing.",
                      })
                    : new ToolFailure({ message: `Unable to edit ${parameters.path}`, error }),
                )
              }),
            )

          return Effect.gen(function* () {
            if (parameters.oldString === parameters.newString) {
              return yield* new ToolFailure({ message: "No changes to apply: oldString and newString are identical." })
            }
            if (parameters.oldString === "") {
              return yield* new ToolFailure({
                message: "oldString must not be empty. Use write to create or overwrite a file.",
              })
            }

            const plan = yield* unableToEdit(mutation.resolve({ path: parameters.path, kind: "file" }))
            const external = plan.target.externalDirectory
            if (external) {
              yield* unableToEdit(assertPermission(LocationMutation.externalDirectoryPermission(external)))
            }

            yield* unableToEdit(assertPermission({ action: "edit", resources: [plan.target.resource], save: ["*"] }))
            const readable = yield* unableToEdit(mutation.revalidate(plan))
            const source = decodeUtf8(yield* unableToEdit(fs.readFile(readable.canonical)))
            const ending = detectLineEnding(source.text)
            const oldString = convertToLineEnding(parameters.oldString, ending)
            const newString = convertToLineEnding(parameters.newString, ending)
            const replacements = countOccurrences(source.text, oldString)
            if (replacements === 0) {
              return yield* new ToolFailure({
                message:
                  "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
              })
            }
            if (replacements > 1 && parameters.replaceAll !== true) {
              return yield* new ToolFailure({
                message:
                  "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
              })
            }

            const replaced =
              parameters.replaceAll === true
                ? source.text.replaceAll(oldString, newString)
                : source.text.replace(oldString, newString)
            const next = splitBom(replaced)
            const result = yield* unableToEdit(
              files.writeIfUnchanged({
                plan,
                expected: source.content,
                content: joinBom(next.text, source.bom || next.bom),
              }),
            )
            return { ...result, replacements } satisfies Success
          })
        },
      }),
    )
  }),
)
