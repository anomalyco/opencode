import { Schema, SchemaGetter } from "effect"
import { checksum } from "@opencode-ai/util/encode"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Skill } from "@opencode-ai/schema/skill"
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
  blob: Schema.Struct({ id: Schema.NonEmptyString, url: Schema.String.check(Schema.isPattern(/^(blob:|data:)/)) }),
})

// Draft storage hydrates content-addressed blobs before this codec runs. Legacy
// inline data remains usable, but unresolved references are not renderable.
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

export const ContentPart = Schema.Union([TextPart, FileAttachmentPart, AgentPart, SkillPart, ImageAttachmentPart])
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
})
export type FileContextItem = typeof FileContextItem.Type
export type ContextItem = FileContextItem

export function contextItemKey(item: ContextItem) {
  const key = `${item.type}:${item.path}:${item.selection?.startLine}:${item.selection?.endLine}`
  if (item.commentID) return `${key}:c=${item.commentID}`
  const comment = item.comment?.trim()
  if (!comment) return key
  const digest = checksum(comment) ?? comment
  return `${key}:c=${digest.slice(0, 8)}`
}

const ContextEntry = Schema.Struct({ ...FileContextItem.fields, key: Persistence.optional(Schema.String) }).pipe(
  Schema.decodeTo(Persistence.struct({ ...FileContextItem.fields, key: Schema.String }).pipe(Schema.toType), {
    decode: SchemaGetter.transform((item) => ({ ...item, key: contextItemKey(item) })),
    encode: SchemaGetter.transform((item) => item),
  }),
)

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
