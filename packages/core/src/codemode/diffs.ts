export * as CodeModeDiffs from "./diffs.js"

import { applyPatch, formatPatch, parsePatch, reversePatch, structuredPatch } from "diff"
import type { StructuredPatch, StructuredPatchHunk } from "diff"
import { Context, Effect, Option, Schema } from "effect"
import type { Result } from "@opencode/schema/tool"
import type { FileAccess } from "../file-access.js"
import { fileDiff } from "../tool/plugin/file-diff.js"

/** The most patch text an execute call keeps on its part; changes past it keep only their counts. */
export const MAX_PATCH_BYTES = 200_000
/** The most changes an execute call lists. */
export const MAX_FILES = 50

export type Status = "added" | "deleted" | "modified"

/**
 * A program's changes to a file, at the place it first changed it. Counts are absent where they aren't known. Later
 * changes to the same file fold into its entry as one diff, from before the first to after the last, when both have a
 * diff; otherwise they follow as entries of their own.
 */
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
// keeps only its counts. A change to a file whose latest entry has a diff folds into that entry when the two diffs
// compose, so the budget then holds the folded diff in place of the earlier one.
export const make = (changed: Effect.Effect<unknown> = Effect.void) => {
  const entries: File[] = []
  let budget = MAX_PATCH_BYTES
  const size = (patch: string | undefined) => (patch === undefined ? 0 : Buffer.byteLength(patch))
  const fold = (change: File) => {
    const index = entries.findLastIndex((entry) => entry.file === change.file)
    const previous = entries[index]
    if (!previous?.patch || change.patch === undefined || change.status === "deleted") return false
    const status = previous.status === "added" ? "added" : change.status
    const folded = compose(change.file, previous.patch, change.patch, status)
    if (!folded) return false
    budget += size(previous.patch)
    const { patch, ...counts } = folded
    if (size(patch) > budget) entries[index] = counts
    else {
      budget -= size(patch)
      entries[index] = folded
    }
    return true
  }
  return {
    record: (change: File) => {
      if (fold(change)) return
      if (entries.length >= MAX_FILES) return
      const { patch, ...counts } = change
      if (patch === undefined || size(patch) > budget) return void entries.push(counts)
      budget -= size(patch)
      entries.push(change)
    },
    files: (): ReadonlyArray<File> => entries.slice(),
    /** Reports the changes recorded so far, as the program runs. */
    changed,
  }
}

/** Records a change when the run has a collector. */
export const record = (change: File) =>
  Effect.flatMap(Effect.serviceOption(Service), (found) => {
    if (Option.isNone(found)) return Effect.void
    found.value.record(change)
    return found.value.changed
  })

/**
 * A change written in full: the diff the write path already built for its permission request, or what is known. An
 * overwrite that changed nothing is no change.
 */
export const written = (target: FileAccess.Target, status: Status, preview: ReturnType<typeof fileDiff> | undefined) =>
  status === "modified" && preview && preview.additions === 0 && preview.deletions === 0
    ? Effect.void
    : record(
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

const lines = (text: string) => {
  if (text === "") return 0
  let count = 1
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++
  return count - Number(text.endsWith("\n"))
}

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
  Effect.tap(effect, (result) => {
    const found = changes(tool, input, result)
    found.forEach(collector.record)
    return found.length > 0 ? collector.changed : Effect.void
  })

// Stands in for a line neither diff shows: unique to its place, and never a line a file holds.
const unknown = (line: number) => `\u0000${line}`

/**
 * Two diffs of one file, the second made after the first, as one diff from before the first to after the second, or
 * undefined when they don't line up. Neither file is read: the file between them is rebuilt from the lines the diffs
 * show around their changes, the lines neither shows stand in as placeholders, and the folded diff leaves them out.
 */
export const compose = (file: string, first: string, second: string, status: Status): File | undefined => {
  const [before] = parsePatch(first)
  const [after] = parsePatch(second)
  if (!before || !after) return undefined
  // A file's last line without a newline can't be placed among lines rebuilt with one.
  if ([...before.hunks, ...after.hunks].some((hunk) => hunk.lines.some((line) => line.startsWith("\\"))))
    return undefined
  const middle: Array<string | undefined> = []
  const place = (start: number, lines: ReadonlyArray<string>, kept: string) => {
    let line = start
    for (const text of lines) {
      if (text[0] !== " " && text[0] !== kept) continue
      const known = middle[line]
      if (known !== undefined && known !== text.slice(1)) return false
      middle[line] = text.slice(1)
      line++
    }
    return true
  }
  // Hunks number lines from 1, except a hunk on an empty side, which starts at 0 and places nothing.
  const placed =
    before.hunks.every((hunk) => place(Math.max(hunk.newStart, 1), hunk.lines, "+")) &&
    after.hunks.every((hunk) => place(Math.max(hunk.oldStart, 1), hunk.lines, "-"))
  if (!placed) return undefined
  const lines = Array.from(
    { length: Math.max(middle.length - 1, 0) },
    (_, index) => middle[index + 1] ?? unknown(index + 1),
  )
  const text = lines.length ? `${lines.join("\n")}\n` : ""
  const start = applyPatch(text, reversePatch(before))
  const end = applyPatch(text, after)
  if (start === false || end === false) return undefined
  if (!lines.some((line) => line.startsWith("\u0000"))) return fileDiff(file, start, end, status)
  return withoutUnknown(file, structuredPatch(file, file, start, end), status)
}

// A diff over a rebuilt file, its hunks split where placeholders stand and the pieces that change nothing left out.
const withoutUnknown = (file: string, patch: StructuredPatch, status: Status): File | undefined => {
  const hunks: StructuredPatchHunk[] = []
  let additions = 0
  let deletions = 0
  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    let piece: StructuredPatchHunk | undefined
    const close = () => {
      if (piece?.lines.some((line) => line[0] !== " ")) hunks.push(piece)
      piece = undefined
    }
    for (const line of hunk.lines) {
      if (line.slice(1).startsWith("\u0000")) {
        // Placeholders match on both sides; one the diff added or removed means the diffs didn't line up.
        if (line[0] !== " ") return undefined
        close()
        oldLine++
        newLine++
        continue
      }
      piece ??= { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, lines: [] }
      piece.lines.push(line)
      if (line[0] !== "+") piece.oldLines++
      if (line[0] !== "-") piece.newLines++
      if (line[0] === "+") additions++
      if (line[0] === "-") deletions++
      if (line[0] !== "+") oldLine++
      if (line[0] !== "-") newLine++
    }
    close()
  }
  return { file, status, additions, deletions, patch: formatPatch({ ...patch, hunks }) }
}
