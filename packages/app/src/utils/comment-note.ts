import type { FileSelection } from "@/context/file"
import { Option, Schema, SchemaGetter } from "effect"

const Origin = Schema.Literals(["review", "file"])
const SelectionNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString])
const FileSelectionSchema = Schema.Struct({
  startLine: SelectionNumber,
  startChar: SelectionNumber,
  endLine: SelectionNumber,
  endChar: SelectionNumber,
})
const PromptCommentSchema = Schema.Struct({
  path: Schema.String,
  selection: Schema.optional(FileSelectionSchema),
  comment: Schema.String,
  preview: Schema.optional(Schema.String),
  origin: Schema.optional(Origin),
})
const CommentMetadataEnvelope = Schema.Struct({
  opencodeComment: Schema.Struct({
    path: Schema.String,
    selection: Schema.optional(Schema.Unknown),
    comment: Schema.String,
    preview: Schema.optional(Schema.Unknown),
    origin: Schema.optional(Schema.Unknown),
  }),
})
const decodeFileSelection = Schema.decodeUnknownOption(FileSelectionSchema)
const decodePreview = Schema.decodeUnknownOption(Schema.String)
const decodeOrigin = Schema.decodeUnknownOption(Origin)
const CommentMetadata = CommentMetadataEnvelope.pipe(
  Schema.decodeTo(PromptCommentSchema, {
    decode: SchemaGetter.transform((value) => ({
      path: value.opencodeComment.path,
      selection: Option.getOrUndefined(decodeFileSelection(value.opencodeComment.selection)),
      comment: value.opencodeComment.comment,
      preview: Option.getOrUndefined(decodePreview(value.opencodeComment.preview)),
      origin: Option.getOrUndefined(decodeOrigin(value.opencodeComment.origin)),
    })),
    encode: SchemaGetter.transform((value) => ({
      opencodeComment: {
        path: value.path,
        selection: value.selection,
        comment: value.comment,
        preview: value.preview,
        origin: value.origin,
      },
    })),
  }),
)
const decodeCommentMetadata = Schema.decodeUnknownOption(CommentMetadata)
const encodeCommentMetadata = Schema.encodeSync(CommentMetadata)
const decodePromptComment = Schema.decodeUnknownOption(PromptCommentSchema)

export type PromptComment = Schema.Schema.Type<typeof PromptCommentSchema>

export function createCommentMetadata(input: PromptComment) {
  return encodeCommentMetadata(input)
}

export function readCommentMetadata(value: unknown) {
  return Option.getOrUndefined(decodeCommentMetadata(value))
}

export function formatCommentNote(input: { path: string; selection?: FileSelection; comment: string }) {
  const start = input.selection ? Math.min(input.selection.startLine, input.selection.endLine) : undefined
  const end = input.selection ? Math.max(input.selection.startLine, input.selection.endLine) : undefined
  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`
  return `The user made the following comment regarding ${range} of ${input.path}: ${input.comment}`
}

export function parseCommentNote(text: string) {
  const match = text.match(
    /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+)$/,
  )
  if (!match) return
  const start = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : undefined
  const end = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined
  return Option.getOrUndefined(
    decodePromptComment({
      path: match[5],
      selection:
        start !== undefined && end !== undefined
          ? {
              startLine: start,
              startChar: 0,
              endLine: end,
              endChar: 0,
            }
          : undefined,
      comment: match[6],
    }),
  )
}
