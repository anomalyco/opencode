import { Schema, SchemaGetter, Struct } from "effect"
import { checksum } from "@opencode-ai/util/encode"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Skill } from "@opencode-ai/schema/skill"
import { Persistence } from "@/runtime/persistence/schema"
import { FileSelection, SelectedLineRange } from "@/workspaces/files/types"

function optional<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  return Schema.optional(Persistence.defaulted(Schema.UndefinedOr(schema), () => undefined))
}

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

export const TextPart = Schema.Struct({ type: Schema.Literal("text"), ...PartBase }).mapFields(
  Struct.map(Schema.mutableKey),
)
export type TextPart = typeof TextPart.Type

export const FileAttachmentPart = Schema.Struct({
  type: Schema.Literal("file"),
  ...PartBase,
  path: Schema.String,
  selection: optional(FileSelection),
  mime: optional(Schema.String),
  filename: optional(Schema.String),
  url: optional(Schema.String),
  source: optional(FilePartSource),
}).mapFields(Struct.map(Schema.mutableKey))
export type FileAttachmentPart = typeof FileAttachmentPart.Type

export const AgentPart = Schema.Struct({ type: Schema.Literal("agent"), ...PartBase, name: Schema.String }).mapFields(
  Struct.map(Schema.mutableKey),
)
export type AgentPart = typeof AgentPart.Type

export const SkillPart = Schema.Struct({
  type: Schema.Literal("skill"),
  ...PartBase,
  id: Skill.ID,
  name: Skill.Name,
}).mapFields(Struct.map(Schema.mutableKey))
export type SkillPart = typeof SkillPart.Type

const ImageFields = {
  type: Schema.Literal("image"),
  id: Schema.String,
  filename: Schema.String,
  sourcePath: optional(Schema.String),
  mime: Schema.String,
}
const Image = Schema.Struct({
  ...ImageFields,
  blob: Schema.Struct({ id: Schema.NonEmptyString, url: Schema.String.check(Schema.isPattern(/^(blob:|data:)/)) }),
}).mapFields(Struct.map(Schema.mutableKey))

// Draft storage hydrates content-addressed blobs before this codec runs. Legacy
// inline data remains usable, but unresolved references are not renderable.
export const ImageAttachmentPart = Schema.Struct({
  ...ImageFields,
  blob: optional(Schema.Struct({ id: optional(Schema.String), url: optional(Schema.String) })),
  dataUrl: optional(Schema.String),
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

export const PromptModel = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: optional(Schema.NullOr(Schema.String)),
}).mapFields(Struct.map(Schema.mutableKey))
export type PromptModel = typeof PromptModel.Type

export const FileContextItem = Schema.Struct({
  type: Schema.Literal("file"),
  path: Schema.String,
  selection: optional(FileSelection),
  comment: optional(Schema.String),
  commentID: optional(Schema.String),
  commentOrigin: optional(Schema.Literals(["review", "file"])),
  preview: optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
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

const ContextEntry = Schema.Struct({ ...FileContextItem.fields, key: optional(Schema.String) }).pipe(
  Schema.decodeTo(
    Schema.Struct({ ...FileContextItem.fields, key: Schema.String })
      .mapFields(Struct.map(Schema.mutableKey))
      .pipe(Schema.toType),
    {
      decode: SchemaGetter.transform((item) => ({ ...item, key: contextItemKey(item) })),
      encode: SchemaGetter.transform((item) => item),
    },
  ),
)

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export const ComposerStore = Schema.Struct({
  prompt: Prompt.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((prompt) =>
        prompt.length ? prompt : DEFAULT_PROMPT.map((part) => ({ ...part })),
      ),
      encode: SchemaGetter.transform((prompt) => prompt),
    }),
  ),
  cursor: optional(
    Schema.Finite.pipe(
      Schema.decode({
        decode: SchemaGetter.transform((cursor) => Math.max(0, cursor)),
        encode: SchemaGetter.transform((cursor) => cursor),
      }),
    ),
  ),
  model: optional(PromptModel),
  mode: optional(Schema.Literals(["normal", "shell"])),
  retry: optional(
    Schema.Struct({
      id: SessionMessage.ID,
      agent: Schema.String,
      providerID: Schema.String,
      modelID: Schema.String,
      variant: optional(Schema.String),
    }),
  ),
  context: Persistence.defaulted(Schema.Struct({ items: Schema.mutableKey(Persistence.array(ContextEntry)) }), () => ({
    items: [],
  })),
}).mapFields(Struct.map(Schema.mutableKey))
export type ComposerStore = typeof ComposerStore.Type

export const LineComment = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  selection: SelectedLineRange,
  comment: Schema.String,
  time: Schema.Number,
}).mapFields(Struct.map(Schema.mutableKey))
export type LineComment = typeof LineComment.Type

export const CommentStore = Schema.Struct({
  comments: Persistence.defaulted(
    Schema.Record(Schema.String, Schema.mutableKey(Persistence.array(LineComment))),
    () => ({}),
  ),
}).mapFields(Struct.map(Schema.mutableKey))
export type CommentStore = typeof CommentStore.Type

export const PromptHistoryComment = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  selection: SelectedLineRange,
  comment: Schema.String,
  time: Schema.Number,
  origin: optional(Schema.Literals(["review", "file"])),
  preview: optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type PromptHistoryComment = typeof PromptHistoryComment.Type

// History entries require a prompt array; only its individual parts recover.
const HistoryPrompt = Schema.Array(Persistence.defaulted(Schema.UndefinedOr(ContentPart), () => undefined)).pipe(
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

export const PromptHistoryState = Schema.Struct({ entries: Schema.mutableKey(Persistence.array(PromptHistoryEntry)) })
