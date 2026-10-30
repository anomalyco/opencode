import type { SessionMessageUser } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { uuid } from "@opencode/util/uuid"
import { FileSelection } from "@/workspaces/files/types"
import { durableNote, LegacyBrowserNote, NoteComment, QuoteComment, type ContextItem } from "./schema"

const PromptFileComment = Persistence.struct({
  type: Schema.optional(Schema.Literal("file")),
  path: Schema.String,
  selection: Persistence.optional(FileSelection),
  comment: Schema.String,
  preview: Persistence.optional(Schema.String),
  origin: Persistence.optional(Schema.Literals(["review", "file"])),
})

type PromptFileComment = typeof PromptFileComment.Type

export type PromptComment = PromptFileComment | NoteComment | QuoteComment

/** An attachment the model receives as a path on the server rather than inline bytes. */
export const PromptAttachmentReference = Persistence.struct({
  name: Schema.String,
  mime: Schema.String,
  path: Schema.String,
})

export type PromptAttachmentReference = typeof PromptAttachmentReference.Type

// Presentation metadata needs a comments list, which prompts from other clients lack; a malformed comment or
// attachment is skipped rather than discarding the rest.
const decodePromptPresentation = Schema.decodeUnknownOption(
  Schema.Struct({
    displayText: Schema.String,
    comments: Schema.Array(Schema.Unknown),
    attachments: Persistence.array(PromptAttachmentReference),
  }),
)

const decodePromptComment = Schema.decodeUnknownOption(
  Schema.Union([NoteComment, QuoteComment, LegacyBrowserNote, PromptFileComment]),
)

export function readPromptPresentation(metadata: SessionMessageUser["metadata"]) {
  return Option.getOrUndefined(
    Option.map(decodePromptPresentation(metadata), (presentation) => ({
      displayText: presentation.displayText,
      attachments: presentation.attachments,
      comments: presentation.comments.flatMap((item): PromptComment[] => Option.toArray(decodePromptComment(item))),
    })),
  )
}

export function formatAttachmentReference(input: PromptAttachmentReference) {
  return `Attached file: \`${input.path}\``
}

/** A note reads with its live subject while it stays in the app process that attached it. */
export function formatNoteComment(input: NoteComment) {
  if (!input.comment.trim()) return `The user referenced ${input.live?.subject ?? input.subject}.`

  return `The user made the following comment regarding ${input.live?.subject ?? input.subject}: ${input.comment}`
}

/** Each quoted line is prefixed, so quoted text cannot end the quote early and read as the user's own words. */
export function formatQuoteComment(input: QuoteComment) {
  const quote = `The user quoted the following from ${input.source?.subject ?? "earlier in the conversation"}:\n${input.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`

  if (!input.comment) return quote

  return `${quote}\n\nThe user made the following comment regarding this quote: ${input.comment}`
}

/** Restores a sent comment to the composer, for example after a revert or fork. */
export function commentContextItem(comment: PromptComment): ContextItem {
  // The message may predate this app process, so a note's live references can no longer be trusted.
  if (comment.type === "note") return { ...durableNote(comment), commentID: uuid() }

  if (comment.type === "quote") return { ...comment, commentID: uuid() }

  return {
    type: "file",
    path: comment.path,
    selection: comment.selection,
    comment: comment.comment,
    preview: comment.preview,
    commentOrigin: comment.origin,
  }
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

  return {
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
  } satisfies PromptComment
}
