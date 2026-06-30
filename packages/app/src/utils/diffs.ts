import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { Option, Schema } from "effect"

type Diff = SnapshotFileDiff | VcsFileDiff

const DiffSchema = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
})
const DiffArray = Schema.mutable(Schema.Array(DiffSchema))
const DiffRecord = Schema.Record(Schema.String, Schema.Unknown)
const Summary = Schema.Struct({
  title: Schema.optional(Schema.Unknown),
  body: Schema.optional(Schema.Unknown),
  diffs: Schema.optional(Schema.Unknown),
})
const decodeDiff = Schema.decodeUnknownOption(DiffSchema)
const decodeDiffArray = Schema.decodeUnknownOption(DiffArray)
const decodeDiffRecord = Schema.decodeUnknownOption(DiffRecord)
const decodeSummary = Schema.decodeUnknownOption(Summary)
const decodeTitle = Schema.decodeUnknownOption(Schema.String)

export function diffs(value: unknown): Diff[] {
  const array = Option.getOrUndefined(decodeDiffArray(value))
  if (array) return Array.isArray(value) ? value : array
  if (Array.isArray(value)) return value.flatMap((item) => Option.getOrUndefined(decodeDiff(item)) ?? [])
  const item = Option.getOrUndefined(decodeDiff(value))
  if (item) return [item]
  return Object.values(Option.getOrUndefined(decodeDiffRecord(value)) ?? {}).flatMap(
    (item) => Option.getOrUndefined(decodeDiff(item)) ?? [],
  )
}

export function message(value: Message): Message {
  if (value.role !== "user") return value

  const raw = value.summary as unknown
  if (raw === undefined) return value
  const summary = Option.getOrUndefined(decodeSummary(raw))
  if (!summary) return { ...value, summary: undefined }

  const title = Option.getOrUndefined(decodeTitle(summary.title))
  const body = Option.getOrUndefined(decodeTitle(summary.body))
  const next = diffs(summary.diffs)

  if (title === summary.title && body === summary.body && next === summary.diffs) return value

  return {
    ...value,
    summary: {
      ...(title === undefined ? {} : { title }),
      ...(body === undefined ? {} : { body }),
      diffs: next,
    },
  }
}
