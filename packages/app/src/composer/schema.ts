import { Schema, SchemaGetter, Struct } from "effect"
import { checksum } from "@opencode/util/encode"
import { SessionMessage } from "@opencode/schema/session-message"
import { Skill } from "@opencode/schema/skill"
import { Persistence } from "@/runtime/persistence/schema"
import { FileSelection, SelectedLineRange } from "@/workspaces/files/types"

const PartBase = {
  content: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
}

const SourceText = Schema.Struct({ value: Schema.String, start: Schema.Number, end: Schema.Number })

const Position = Schema.Struct({ line: Schema.Number, character: Schema.Number })

const FilePartSource = Schema.Union([
  Schema.Struct({ type: Schema.Literal("file"), text: SourceText, path: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("symbol"),
    text: SourceText,
    path: Schema.String,
    range: Schema.Struct({ start: Position, end: Position }),
    name: Schema.String,
    kind: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("resource"), text: SourceText, clientName: Schema.String, uri: Schema.String }),
])

export const TextPart = Persistence.struct({ type: Schema.Literal("text"), ...PartBase })

export type TextPart = typeof TextPart.Type

export const FileAttachmentPart = Persistence.struct({
  type: Schema.Literal("file"),
  ...PartBase,
  path: Schema.String,
  selection: Persistence.optional(FileSelection),
  mime: Persistence.optional(Schema.String),
  filename: Persistence.optional(Schema.String),
  description: Persistence.optional(Schema.String),
  url: Persistence.optional(Schema.String),
  source: Persistence.optional(FilePartSource),
})

export type FileAttachmentPart = typeof FileAttachmentPart.Type

export const AgentPart = Persistence.struct({ type: Schema.Literal("agent"), ...PartBase, name: Schema.String })

export type AgentPart = typeof AgentPart.Type

export const SkillPart = Persistence.struct({
  type: Schema.Literal("skill"),
  ...PartBase,
  id: Skill.ID,
  name: Skill.Name,
})

export type SkillPart = typeof SkillPart.Type

const ImageFields = {
  type: Schema.Literal("image"),
  id: Schema.String,
  filename: Schema.String,
  sourcePath: Persistence.optional(Schema.String),
  mime: Schema.String,
}

const Image = Persistence.struct({
  ...ImageFields,
  // An empty URL is an image whose bytes are still in the draft store; see `resolveBlobUrl`.
  blob: Schema.Struct({ id: Schema.NonEmptyString, url: Schema.String.check(Schema.isPattern(/^(blob:|data:|$)/)) }),
})

// Draft storage keeps content-addressed blobs in the store until an image is shown or sent; a
// reference without a URL resolves through `resolveBlobUrl`. Legacy inline data remains usable.
export const ImageAttachmentPart = Schema.Struct({
  ...ImageFields,
  blob: Persistence.optional(
    Schema.Struct({ id: Persistence.optional(Schema.String), url: Persistence.optional(Schema.String) }),
  ),
  dataUrl: Persistence.optional(Schema.String),
}).pipe(
  Schema.decodeTo(Schema.toType(Image), {
    decode: SchemaGetter.transform((value) => {
      const id = value.blob?.id ?? value.dataUrl ?? ""
      const url = value.blob?.url

      return {
        type: value.type,
        id: value.id,
        filename: value.filename,
        sourcePath: value.sourcePath,
        mime: value.mime,
        blob: {
          id,
          url: url?.startsWith("blob:") || url?.startsWith("data:") ? url : id.startsWith("data:") ? id : "",
        },
      }
    }),
    encode: SchemaGetter.transform((value) => value),
  }),
)

export type ImageAttachmentPart = typeof ImageAttachmentPart.Type

// A file the model receives as a path on the server: its bytes never enter the draft store.
export const PathAttachmentPart = Persistence.struct({
  type: Schema.Literal("path"),
  id: Schema.String,
  filename: Schema.String,
  mime: Schema.String,
  path: Schema.String,
})

export type PathAttachmentPart = typeof PathAttachmentPart.Type

export const ContentPart = Schema.Union([
  TextPart,
  FileAttachmentPart,
  AgentPart,
  SkillPart,
  ImageAttachmentPart,
  PathAttachmentPart,
])

export type ContentPart = typeof ContentPart.Type

export const Prompt = Persistence.array(ContentPart)

export type Prompt = typeof Prompt.Type

export const PromptModel = Persistence.struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Persistence.optional(Schema.NullOr(Schema.String)),
})

export type PromptModel = typeof PromptModel.Type

export const FileContextItem = Persistence.struct({
  type: Schema.Literal("file"),
  path: Schema.String,
  selection: Persistence.optional(FileSelection),
  comment: Persistence.optional(Schema.String),
  commentID: Persistence.optional(Schema.String),
  commentOrigin: Persistence.optional(Schema.Literals(["review", "file"])),
  preview: Persistence.optional(Schema.String),
  // A file restored from a sent prompt keeps the name and description it was sent with.
  name: Persistence.optional(Schema.String),
  description: Persistence.optional(Schema.String),
})

export type FileContextItem = typeof FileContextItem.Type

const NoteFields = {
  type: Schema.Literal("note"),
  origin: Schema.String,
  label: Schema.String,
  icon: Schema.String,
  subject: Schema.String,
  href: Persistence.optional(Schema.String),
  live: Persistence.optional(Persistence.struct({ subject: Schema.String, href: Persistence.optional(Schema.String) })),
  comment: Schema.String,
}

/** An extension's comment on something other than workspace lines, as sent in message metadata. */
export const NoteComment = Persistence.struct(NoteFields)

export type NoteComment = typeof NoteComment.Type

export const NoteContextItem = Persistence.struct({ ...NoteFields, commentID: Schema.String })

export type NoteContextItem = typeof NoteContextItem.Type

export type ContextItem = FileContextItem | NoteContextItem

/** A note's live part names state inside the app process that attached it; anything that may outlive it drops it. */
export function durableNote<Note extends NoteComment>(note: Note) {
  return Struct.omit(note, ["live"])
}

// Legacy data: desktop builds before extension notes stored browser element comments as their own type, in drafts
// and in message metadata. They read as the browser extension's note, without the element ref of their process.
const LegacyBrowserComment = Persistence.struct({
  type: Schema.Literal("browser"),
  tabID: Schema.String,
  url: Schema.String,
  title: Persistence.optional(Schema.String),
  element: Persistence.struct({
    ref: Persistence.optional(Schema.String),
    selector: Schema.String,
    label: Schema.String,
    role: Persistence.optional(Schema.String),
    name: Persistence.optional(Schema.String),
    text: Persistence.optional(Schema.String),
  }),
  comment: Schema.String,
})

export const LegacyBrowserNote = LegacyBrowserComment.pipe(
  Schema.decodeTo(Schema.toType(NoteComment), {
    decode: SchemaGetter.transform(legacyBrowserNote),
    encode: SchemaGetter.forbidden(() => "Legacy browser comments are read-only"),
  }),
)

// The subject those builds sent for an element whose ref no longer applies.
function legacyBrowserNote(item: typeof LegacyBrowserComment.Type): NoteComment {
  const element = item.element

  const details = [
    element.role ? `role ${element.role}` : undefined,
    element.name ? `accessible name ${JSON.stringify(element.name)}` : undefined,
    element.text && element.text !== element.name ? `text ${JSON.stringify(element.text.slice(0, 80))}` : undefined,
    element.selector
      ? `selector ${JSON.stringify(element.selector)}${element.selector.includes(" >>> ") ? ' (">>>" enters a shadow root)' : ""}`
      : undefined,
  ].filter((detail) => detail !== undefined)

  return {
    type: "note",
    origin: "browser",
    label: element.label,
    icon: "select-element",
    subject: `the ${JSON.stringify(element.label)} element in browser tab ${item.tabID} at ${item.url}${details.length ? ` (${details.join("; ")})` : ""}`,
    href: item.tabID,
    comment: item.comment,
  }
}

export function contextItemKey(item: ContextItem) {
  if (item.type === "note") return `note:${item.origin}:c=${item.commentID}`
  const key = `${item.type}:${item.path}:${item.selection?.startLine}:${item.selection?.endLine}`

  if (item.commentID) return `${key}:c=${item.commentID}`
  const comment = item.comment?.trim()

  if (!comment) return key
  const digest = checksum(comment) ?? comment

  return `${key}:c=${digest.slice(0, 8)}`
}

const FileContextEntry = Schema.Struct({ ...FileContextItem.fields, key: Persistence.optional(Schema.String) }).pipe(
  Schema.decodeTo(Persistence.struct({ ...FileContextItem.fields, key: Schema.String }).pipe(Schema.toType), {
    decode: SchemaGetter.transform((item) => ({ ...item, key: contextItemKey(item) })),
    encode: SchemaGetter.transform((item) => item),
  }),
)

const NoteContextEntry = Schema.Struct({
  ...NoteContextItem.fields,
  key: Persistence.optional(Schema.String),
}).pipe(
  Schema.decodeTo(Persistence.struct({ ...NoteContextItem.fields, key: Schema.String }).pipe(Schema.toType), {
    // A stored draft can outlive the app process that attached the note.
    decode: SchemaGetter.transform((item) => ({ ...durableNote(item), key: contextItemKey(item) })),
    encode: SchemaGetter.transform((item) => item),
  }),
)

const LegacyBrowserContextEntry = Schema.Struct({
  ...LegacyBrowserComment.fields,
  commentID: Schema.String,
  key: Persistence.optional(Schema.String),
}).pipe(
  Schema.decodeTo(Persistence.struct({ ...NoteContextItem.fields, key: Schema.String }).pipe(Schema.toType), {
    decode: SchemaGetter.transform((item) => {
      const note = { ...legacyBrowserNote(item), commentID: item.commentID }

      return { ...note, key: contextItemKey(note) }
    }),
    encode: SchemaGetter.forbidden(() => "Legacy browser comments are read-only"),
  }),
)

const ContextEntry = Schema.Union([FileContextEntry, NoteContextEntry, LegacyBrowserContextEntry])

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export const ComposerStore = Persistence.struct({
  prompt: Prompt.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((prompt) =>
        prompt.length ? prompt : DEFAULT_PROMPT.map((part) => ({ ...part })),
      ),
      encode: SchemaGetter.transform((prompt) => prompt),
    }),
  ),
  cursor: Persistence.optional(
    Schema.Finite.pipe(
      Schema.decode({
        decode: SchemaGetter.transform((cursor) => Math.max(0, cursor)),
        encode: SchemaGetter.transform((cursor) => cursor),
      }),
    ),
  ),
  model: Persistence.optional(PromptModel),
  mode: Persistence.optional(Schema.Literals(["normal", "shell"])),
  retry: Persistence.optional(
    Schema.Struct({
      id: SessionMessage.ID,
      agent: Schema.String,
      providerID: Schema.String,
      modelID: Schema.String,
      variant: Persistence.optional(Schema.String),
    }),
  ),
  context: Persistence.struct({ items: Persistence.array(ContextEntry) }),
})

export type ComposerStore = typeof ComposerStore.Type

export const LineComment = Persistence.struct({
  id: Schema.String,
  file: Schema.String,
  selection: SelectedLineRange,
  comment: Schema.String,
  time: Schema.Number,
})

export type LineComment = typeof LineComment.Type

export const CommentStore = Persistence.struct({
  comments: Schema.Record(Schema.String, Schema.mutableKey(Persistence.array(LineComment))),
})

export type CommentStore = typeof CommentStore.Type

export const PromptHistoryComment = Persistence.struct({
  id: Schema.String,
  path: Schema.String,
  selection: SelectedLineRange,
  comment: Schema.String,
  time: Schema.Number,
  origin: Persistence.optional(Schema.Literals(["review", "file"])),
  preview: Persistence.optional(Schema.String),
})

export type PromptHistoryComment = typeof PromptHistoryComment.Type

// History entries require a prompt array; only its individual parts recover.
const HistoryPrompt = Schema.Array(Persistence.fallback(Schema.UndefinedOr(ContentPart), () => undefined)).pipe(
  Schema.decodeTo(Schema.toType(Prompt), {
    decode: SchemaGetter.transform((parts) => parts.filter((part) => part !== undefined)),
    encode: SchemaGetter.transform((parts) => parts),
  }),
)

const HistoryEntry = Schema.Struct({ prompt: HistoryPrompt, comments: Persistence.array(PromptHistoryComment) })

export const PromptHistoryEntry = Schema.Union([HistoryEntry, HistoryPrompt]).pipe(
  Schema.decodeTo(Schema.toType(HistoryEntry), {
    decode: SchemaGetter.transform((entry) => ("prompt" in entry ? entry : { prompt: entry, comments: [] })),
    encode: SchemaGetter.transform((entry) => entry),
  }),
)

export type PromptHistoryEntry = typeof PromptHistoryEntry.Type

export const PromptHistoryState = Persistence.struct({ entries: Persistence.array(PromptHistoryEntry) })
