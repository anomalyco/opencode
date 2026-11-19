export * as CodeModeDiffs from "./diffs.js"

import { Patch } from "@opencode/util/patch"
import { isUtf8 } from "buffer"
import { Context, Effect, Option, Result } from "effect"
import type { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { fileDiff } from "../tool/plugin/file-diff.js"

/** The most patch text an execute call keeps on its part; files past it keep only their counts. */
export const MAX_PATCH_BYTES = 200_000
/** The most files an execute call lists. */
export const MAX_FILES = 50

/** What a file held: its text, `undefined` when it didn't exist, or `binary` when it isn't text. */
export type Content = string | undefined | { readonly binary: true }

export type File = {
  readonly file: string
  readonly status: "added" | "deleted" | "modified"
  readonly additions: number
  readonly deletions: number
  readonly patch?: string
}

type Entry = { readonly resource: string; readonly before: Content; after: Content }

export type Collector = ReturnType<typeof make>

/** The files a Code Mode program changed: each keeps what it held before its first change and after its last. */
export class Service extends Context.Service<Service, Collector>()("@opencode/CodeModeDiffs") {}

export const make = () => {
  const entries = new Map<string, Entry>()
  return {
    record: (key: string, resource: string, before: Content, after: Content) => {
      const found = entries.get(key)
      if (found) found.after = after
      else entries.set(key, { resource, before, after })
    },
    files: () => summarize([...entries.values()]),
  }
}

/** Records a change when the run has a collector. */
export const record = (target: FileAccess.Target, before: Content, after: Content) =>
  Effect.map(Effect.serviceOption(Service), (found) => {
    if (Option.isSome(found)) found.value.record(FileAccess.key(target), target.resource, before, after)
  })

// One diff per file from its first content to its last, then the cap: files past the patch budget keep their counts.
export const summarize = (entries: ReadonlyArray<Entry>) => {
  let budget = MAX_PATCH_BYTES
  return entries
    .filter((entry) => !same(entry.before, entry.after))
    .slice(0, MAX_FILES)
    .map((entry): File => {
      const status = entry.before === undefined ? "added" : entry.after === undefined ? "deleted" : "modified"
      const before = entry.before ?? ""
      const after = entry.after ?? ""
      if (typeof before !== "string" || typeof after !== "string")
        return { file: entry.resource, status, additions: 0, deletions: 0 }
      const diff = fileDiff(entry.resource, before, after, status)
      const size = Buffer.byteLength(diff.patch)
      if (size > budget) return { file: entry.resource, status, additions: diff.additions, deletions: diff.deletions }
      budget -= size
      return { file: diff.file, status, additions: diff.additions, deletions: diff.deletions, patch: diff.patch }
    })
}

const same = (left: Content, right: Content) =>
  typeof left === "object" || typeof right === "object" ? false : left === right

export const read = (files: Environment.Files, absolute: string) =>
  files.read(absolute).pipe(
    Effect.map(({ bytes }): Content => (isUtf8(bytes) ? Buffer.from(bytes).toString() : { binary: true })),
    Effect.catch(() => Effect.succeed<Content>(undefined)),
  )

/** The paths an inner edit, write or patch call names, so their content can be read around the call. */
export const paths = (tool: string, input: unknown): ReadonlyArray<string> => {
  if (typeof input !== "object" || input === null) return []
  const value = input as Record<string, unknown>
  if ((tool === "edit" || tool === "write") && typeof value.path === "string") return [value.path]
  if (tool !== "patch" || typeof value.patchText !== "string") return []
  const parsed = Patch.parse(value.patchText)
  if (Result.isFailure(parsed)) return []
  return parsed.success.flatMap((hunk) => [
    hunk.path,
    ...(hunk.type === "update" && hunk.movePath ? [hunk.movePath] : []),
  ])
}

/** Runs an inner tool call, recording the content of the files it names before and after it. */
export const around = <A, E, R>(
  collector: Collector,
  access: FileAccess.Interface,
  tool: string,
  input: unknown,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const named = paths(tool, input)
    if (named.length === 0) return yield* effect
    const targets = (yield* Effect.forEach(named, (file) =>
      access.resolve({ path: file, kind: "file" }).pipe(Effect.option),
    )).flatMap((target) => (Option.isSome(target) ? [target.value] : []))
    const before = yield* Effect.forEach(targets, (target) => read(target.environment.files, target.absolute))
    return yield* effect.pipe(
      Effect.ensuring(
        Effect.forEach(targets, (target, index) =>
          Effect.map(read(target.environment.files, target.absolute), (after) =>
            collector.record(FileAccess.key(target), target.resource, before[index], after),
          ),
        ),
      ),
    )
  })
