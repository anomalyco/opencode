export * as ConfigFile from "./file.js"

import { isDeepStrictEqual } from "node:util"
import { isRecord } from "@opencode-ai/ai/utils/record"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Schema, Semaphore } from "effect"
import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  modify,
  parseTree,
  type Node,
  type ParseError,
} from "jsonc-parser"

export class UpdateError extends Schema.TaggedError<UpdateError>()("ConfigFile.UpdateError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const isJson = Schema.is(Schema.MutableJson)
const isDocument = (value: unknown): value is Schema.MutableJsonObject => isRecord(value) && isJson(value)
const lock = Semaphore.makeUnsafe(1)

/**
 * Edits an existing JSON(C) file using raw source values, not resolved Config.Info.
 * The synchronous callback mutates a source clone; its return value is ignored.
 * Validates JSON only; normalization and substitution remain the reader's job.
 * Does not discover files, start watchers, or refresh Config state.
 * Read-modify-write calls are serialized within this process.
 */
export const update = Effect.fn("ConfigFile.update")(
  function* (
    filepath: string,
    mutate: (draft: Schema.MutableJsonObject) => void,
  ): Effect.fn.Return<Schema.JsonObject, UpdateError, FSUtil.Service> {
    const fs = yield* FSUtil.Service
    const text = yield* fs
      .readFileString(filepath)
      .pipe(Effect.mapError((cause) => new UpdateError({ message: `Failed to read config: ${filepath}`, cause })))
    const errors: ParseError[] = []
    const current = parseSource(text, errors)
    if (errors.length || !isDocument(current))
      return yield* Effect.fail(new UpdateError({ message: `Invalid config file: ${filepath}` }))

    const next = yield* Effect.try({
      try: () => {
        const draft = structuredClone(current)
        mutate(draft)
        return draft
      },
      catch: (cause) => new UpdateError({ message: "Config update failed", cause }),
    })
    if (!isDocument(next))
      return yield* Effect.fail(new UpdateError({ message: `Config update must produce a JSON object: ${filepath}` }))

    const edits = changes(current, next)
    if (!edits.length) return next
    const updated = yield* Effect.try({
      try: () => edits.reduce(patch, text),
      catch: (cause) => new UpdateError({ message: `Failed to patch config: ${filepath}`, cause }),
    })
    // Duplicate keys can make parse choose the last value while modify edits the first.
    const written = parseSource(updated, errors)
    if (errors.length || !isDeepStrictEqual(written, next))
      return yield* Effect.fail(
        new UpdateError({ message: `Config patch does not match the requested update: ${filepath}` }),
      )
    const temporary = filepath + ".tmp"
    yield* fs.writeFileString(temporary, updated.endsWith("\n") ? updated : updated + "\n").pipe(
      Effect.andThen(fs.rename(temporary, filepath)),
      Effect.mapError((cause) => new UpdateError({ message: `Failed to write config: ${filepath}`, cause })),
    )
    return next
  },
  (effect) => lock.withPermit(effect),
)

type Edit = { readonly path: (string | number)[]; readonly value: unknown }

function parseSource(text: string, errors: ParseError[]) {
  const root = parseTree(text, errors, { allowTrailingComma: true })
  if (!root || errors.length) return undefined
  // parse() assigns onto {}, invoking the __proto__ setter instead of retaining
  // an own JSON key. Construct object entries from the AST without those setters.
  const value = (node: Node): unknown => {
    if (node.type === "array") return (node.children ?? []).map(value)
    if (node.type === "object")
      return Object.fromEntries(
        (node.children ?? []).map((property) => {
          const child = property.children?.[1]
          return [property.children?.[0]?.value, child && value(child)]
        }),
      )
    return node.value
  }
  return value(root)
}

function patch(text: string, edit: Edit) {
  if (edit.value !== undefined)
    return applyEdits(
      text,
      modify(text, edit.path, edit.value, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
    )

  const tree = parseTree(text)
  const node = tree && findNodeAtLocation(tree, edit.path)
  if (!node) return text
  // jsonc-parser removes adjacent comments along with the separator. Remove only
  // the property/element itself and one comma, leaving surrounding comments intact.
  const target = node.parent?.type === "property" ? node.parent : node
  const siblings = target.parent?.children ?? []
  const previous = siblings[siblings.indexOf(target) - 1]
  const scanner = createScanner(text, true)
  scanner.setPosition(target.offset + target.length)
  scanner.scan()
  const following = text[scanner.getTokenOffset()] === ","
  if (!following && previous) {
    scanner.setPosition(previous.offset + previous.length)
    scanner.scan()
  }
  return applyEdits(text, [
    { offset: target.offset, length: target.length, content: "" },
    ...(following || previous ? [{ offset: scanner.getTokenOffset(), length: 1, content: "" }] : []),
  ])
}

function changes(before: unknown, after: unknown, path: (string | number)[] = []): Edit[] {
  if (isDeepStrictEqual(before, after)) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    return [
      ...after.flatMap((value, index) => changes(before[index], value, [...path, index])),
      // Remove from the end so earlier deletions cannot shift later paths.
      ...before
        .slice(after.length)
        .map((_, index) => ({ path: [...path, after.length + index], value: undefined }))
        .toReversed(),
    ]
  }
  if (isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => {
      if (!Object.hasOwn(after, key)) return [{ path: [...path, key], value: undefined }]
      if (!Object.hasOwn(before, key)) return [{ path: [...path, key], value: after[key] }]
      return changes(before[key], after[key], [...path, key])
    })
  }
  return [{ path, value: after }]
}
