export * as CodeModeDiffs from "./diffs.js"

import { Context, Effect, Option, Schema } from "effect"
import type { Result } from "@opencode/schema/tool"
import { FileAccess } from "../file-access.js"
import { fileDiff } from "../tool/plugin/file-diff.js"

/** The most patch text an execute call keeps on its part; changes past it keep only their counts. */
export const MAX_PATCH_BYTES = 200_000
/** The most changes an execute call lists. */
export const MAX_FILES = 50

export type Status = "added" | "deleted" | "modified"

/** One change a program made to a file, in the order it made them. Counts are absent where they aren't known. */
export type File = {
  readonly file: string
  readonly status: Status
  readonly additions?: number
  readonly deletions?: number
  readonly patch?: string
}

export type Collector = ReturnType<typeof make>

/** The changes a Code Mode program made to files. Nothing here reads a file: each change brings its own diff. */
export class Service extends Context.Service<Service, Collector>()("@opencode/CodeModeDiffs") {}

// Each change is kept as it arrives, within the budget: past MAX_FILES it is dropped, and past the patch budget it
// keeps only its counts.
export const make = () => {
  const entries: File[] = []
  let budget = MAX_PATCH_BYTES
  return {
    record: (change: File) => {
      if (entries.length >= MAX_FILES) return
      const { patch, ...counts } = change
      const size = patch === undefined ? 0 : Buffer.byteLength(patch)
      if (patch === undefined || size > budget) return void entries.push(counts)
      budget -= size
      entries.push(change)
    },
    files: (): ReadonlyArray<File> => entries,
  }
}

/** Records a change when the run has a collector. */
export const record = (change: File) =>
  Effect.map(Effect.serviceOption(Service), (found) => {
    if (Option.isSome(found)) found.value.record(change)
  })

/** A change written in full: the diff the write path already built for its permission request, or what is known. */
export const written = (target: FileAccess.Target, status: Status, preview: ReturnType<typeof fileDiff> | undefined) =>
  record(
    preview
      ? {
          file: target.resource,
          status,
          additions: preview.additions,
          deletions: preview.deletions,
          patch: preview.patch,
        }
      : { file: target.resource, status },
  )

/** Text added to the end of a file: its lines are what it adds, counted without reading the file. */
export const appended = (target: FileAccess.Target, status: Status, text: string | undefined) =>
  record(
    text === undefined
      ? { file: target.resource, status }
      : { file: target.resource, status, additions: lines(text), deletions: 0 },
  )

const lines = (text: string) => (text === "" ? 0 : text.split("\n").length - Number(text.endsWith("\n")))

const ChangedFile = Schema.Struct({
  file: Schema.String,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  patch: Schema.optional(Schema.String),
})

const decodeFiles = Schema.decodeUnknownOption(Schema.Struct({ files: Schema.Array(Schema.Unknown) }))
const decodeFile = Schema.decodeUnknownOption(ChangedFile)
const decodeWrite = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String, content: Schema.String }))

/**
 * The changes an inner call made, from its own result. Edit and patch return each file's diff in `metadata.files`.
 * Write returns none, so its change comes from what it was asked to write: a created file's lines are its content;
 * an overwrite's counts aren't known without reading the file.
 */
export const changes = (tool: string, input: unknown, result: Result): ReadonlyArray<File> => {
  if (tool === "edit" || tool === "patch")
    return Option.match(decodeFiles(result.metadata), {
      onNone: () => [],
      onSome: ({ files }) =>
        files.flatMap((value) =>
          Option.toArray(decodeFile(value)).map(({ status = "modified", ...file }) => ({ ...file, status })),
        ),
    })
  if (tool !== "write") return []
  const args = Option.getOrUndefined(decodeWrite(input))
  const match =
    typeof result.output === "string" ? /^(Created|Wrote) file successfully: (.+)$/.exec(result.output) : null
  if (!args || !match) return []
  const file = match[2]!
  if (match[1] === "Wrote") return [{ file, status: "modified" }]
  const diff = fileDiff(file, "", args.content, "added")
  return [{ file, status: "added", additions: diff.additions, deletions: 0, patch: diff.patch }]
}

/** Runs an inner tool call and records the changes its result reports. */
export const around = <E, R>(collector: Collector, tool: string, input: unknown, effect: Effect.Effect<Result, E, R>) =>
  Effect.tap(effect, (result) => Effect.sync(() => changes(tool, input, result).forEach(collector.record)))
