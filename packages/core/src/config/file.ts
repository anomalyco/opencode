export * as ConfigFile from "./file.js"

import { isDeepStrictEqual } from "node:util"
import { isRecord } from "@opencode-ai/ai/utils/record"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Schema, Semaphore } from "effect"
import { produce, type Draft } from "immer"
import { applyEdits, createScanner, findNodeAtLocation, modify, parse, parseTree, type ParseError } from "jsonc-parser"

export class UpdateError extends Schema.TaggedError<UpdateError>()("ConfigFile.UpdateError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const isDocument = Schema.is(Schema.JsonObject)
const lock = Semaphore.makeUnsafe(1)

/**
 * Edits an existing JSON(C) file using raw source values, not resolved Config.Info.
 * Validates JSON only; normalization and substitution remain the reader's job.
 * Does not discover files, start watchers, or refresh Config state.
 * Read-modify-write calls are serialized within this process.
 */
export const update: (
  filepath: string,
  mutate: (draft: Draft<Schema.JsonObject>) => void,
) => Effect.Effect<Schema.JsonObject, UpdateError, FSUtil.Service> = Effect.fn("ConfigFile.update")(
  function* (filepath: string, mutate: (draft: Draft<Schema.JsonObject>) => void) {
    const fs = yield* FSUtil.Service
    const text = yield* fs
      .readFileString(filepath)
      .pipe(Effect.mapError((cause) => new UpdateError({ message: `Failed to read config: ${filepath}`, cause })))
    const errors: ParseError[] = []
    const current: unknown = parse(text, errors, { allowTrailingComma: true })
    if (errors.length || !isDocument(current))
      return yield* Effect.fail(new UpdateError({ message: `Invalid config file: ${filepath}` }))

    const next = yield* Effect.try({
      try: () => produce(current, mutate),
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
    const written: unknown = parse(updated, errors, { allowTrailingComma: true })
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
