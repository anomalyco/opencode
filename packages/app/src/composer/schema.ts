import { checksum } from "@opencode/util/encode"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Skill } from "@opencode/schema/skill"
import { Codec } from "@/runtime/persistence/codec"
import { FileSelection, SelectedLineRange } from "@/workspaces/files/types"

// Identifiers defined by the shared Effect schemas keep their branded types; the renderer checks
// them as strings so the shared schema module stays out of its startup path.
const branded = <T extends string>() =>
  Codec.make<T, string>(
    (v) => (typeof v === "string" ? (v as T) : Codec.INVALID),
    (v) => v,
  )
const SkillID = branded<typeof Skill.ID.Type>()
const SkillName = branded<typeof Skill.Name.Type>()
const MessageID = Codec.make<typeof SessionMessage.ID.Type, string>(
  (v) => (typeof v === "string" && v.startsWith("msg_") ? (v as typeof SessionMessage.ID.Type) : Codec.INVALID),
  (v) => v,
)
const nonEmptyString = Codec.make<string, string>(
  (v) => (typeof v === "string" && v.length > 0 ? v : Codec.INVALID),
  (v) => v,
)

const PartBase = {
  content: Codec.string,
  start: Codec.number,
  end: Codec.number,
}

const SourceText = Codec.struct({ value: Codec.string, start: Codec.number, end: Codec.number })
const Position = Codec.struct({ line: Codec.number, character: Codec.number })
const FilePartSource = Codec.union([
  Codec.struct({ type: Codec.literal("file"), text: SourceText, path: Codec.string }),
  Codec.struct({
    type: Codec.literal("symbol"),
    text: SourceText,
    path: Codec.string,
    range: Codec.struct({ start: Position, end: Position }),
    name: Codec.string,
    kind: Codec.number,
  }),
  Codec.struct({ type: Codec.literal("resource"), text: SourceText, clientName: Codec.string, uri: Codec.string }),
])

export const TextPart = Codec.struct({ type: Codec.literal("text"), ...PartBase })
export type TextPart = typeof TextPart.Type

export const FileAttachmentPart = Codec.struct({
  type: Codec.literal("file"),
  ...PartBase,
  path: Codec.string,
  selection: Codec.lenientOptional(FileSelection),
  mime: Codec.lenientOptional(Codec.string),
  filename: Codec.lenientOptional(Codec.string),
  url: Codec.lenientOptional(Codec.string),
  source: Codec.lenientOptional(FilePartSource),
})
export type FileAttachmentPart = typeof FileAttachmentPart.Type

export const AgentPart = Codec.struct({ type: Codec.literal("agent"), ...PartBase, name: Codec.string })
export type AgentPart = typeof AgentPart.Type

export const SkillPart = Codec.struct({
  type: Codec.literal("skill"),
  ...PartBase,
  id: SkillID,
  name: SkillName,
})
export type SkillPart = typeof SkillPart.Type

const ImageFields = {
  type: Codec.literal("image"),
  id: Codec.string,
  filename: Codec.string,
  sourcePath: Codec.lenientOptional(Codec.string),
  mime: Codec.string,
}
const Image = Codec.struct({
  ...ImageFields,
  // An empty URL is an image whose bytes are still in the draft store; see `resolveBlobUrl`.
  blob: Codec.struct({
    id: nonEmptyString,
    url: Codec.make<string, string>(
      (v) => (typeof v === "string" && /^(blob:|data:|$)/.test(v) ? v : Codec.INVALID),
      (v) => v,
    ),
  }),
})
const StoredImage = Codec.struct({
  ...ImageFields,
  blob: Codec.lenientOptional(
    Codec.struct({ id: Codec.lenientOptional(Codec.string), url: Codec.lenientOptional(Codec.string) }),
  ),
  dataUrl: Codec.lenientOptional(Codec.string),
})

// Draft storage keeps content-addressed blobs in the store until an image is shown or sent; a
// reference without a URL resolves through `resolveBlobUrl`. Legacy inline data remains usable.
export const ImageAttachmentPart = Codec.decodeTo(StoredImage, Image, {
  decode: (value) => {
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
  },
  encode: (value) => value,
})
export type ImageAttachmentPart = typeof ImageAttachmentPart.Type

// A file the model receives as a path on the server: its bytes never enter the draft store.
export const PathAttachmentPart = Codec.struct({
  type: Codec.literal("path"),
  id: Codec.string,
  filename: Codec.string,
  mime: Codec.string,
  path: Codec.string,
})
export type PathAttachmentPart = typeof PathAttachmentPart.Type

export const ContentPart = Codec.union([
  TextPart,
  FileAttachmentPart,
  AgentPart,
  SkillPart,
  ImageAttachmentPart,
  PathAttachmentPart,
])
export type ContentPart = typeof ContentPart.Type
export const Prompt = Codec.lenientArray(ContentPart)
export type Prompt = typeof Prompt.Type

export const PromptModel = Codec.struct({
  providerID: Codec.string,
  modelID: Codec.string,
  variant: Codec.lenientOptional(Codec.nullOr(Codec.string)),
})
export type PromptModel = typeof PromptModel.Type

export const FileContextItem = Codec.struct({
  type: Codec.literal("file"),
  path: Codec.string,
  selection: Codec.lenientOptional(FileSelection),
  comment: Codec.lenientOptional(Codec.string),
  commentID: Codec.lenientOptional(Codec.string),
  commentOrigin: Codec.lenientOptional(Codec.literals(["review", "file"])),
  preview: Codec.lenientOptional(Codec.string),
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

const StoredContextEntry = Codec.struct({ ...FileContextItem.fields, key: Codec.lenientOptional(Codec.string) })
const ContextEntry = Codec.transform(StoredContextEntry, {
  decode: (item) => ({ ...item, key: contextItemKey(item) }),
  encode: (item) => item,
})

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

const Cursor = Codec.transform(Codec.number, { decode: (cursor) => Math.max(0, cursor), encode: (cursor) => cursor })

export const ComposerStore = Codec.struct({
  prompt: Codec.transform(Prompt, {
    decode: (prompt) => (prompt.length ? prompt : DEFAULT_PROMPT.map((part) => ({ ...part }))),
    encode: (prompt) => prompt,
  }),
  cursor: Codec.lenientOptional(Cursor),
  model: Codec.lenientOptional(PromptModel),
  mode: Codec.lenientOptional(Codec.literals(["normal", "shell"])),
  retry: Codec.lenientOptional(
    Codec.struct({
      id: MessageID,
      agent: Codec.string,
      providerID: Codec.string,
      modelID: Codec.string,
      variant: Codec.lenientOptional(Codec.string),
    }),
  ),
  context: Codec.struct({ items: Codec.lenientArray(ContextEntry) }),
})
export type ComposerStore = typeof ComposerStore.Type

export const LineComment = Codec.struct({
  id: Codec.string,
  file: Codec.string,
  selection: SelectedLineRange,
  comment: Codec.string,
  time: Codec.number,
})
export type LineComment = typeof LineComment.Type

export const CommentStore = Codec.struct({
  comments: Codec.record(Codec.lenientArray(LineComment)),
})
export type CommentStore = typeof CommentStore.Type

export const PromptHistoryComment = Codec.struct({
  id: Codec.string,
  path: Codec.string,
  selection: SelectedLineRange,
  comment: Codec.string,
  time: Codec.number,
  origin: Codec.lenientOptional(Codec.literals(["review", "file"])),
  preview: Codec.lenientOptional(Codec.string),
})
export type PromptHistoryComment = typeof PromptHistoryComment.Type

// History entries require a prompt array; only its individual parts recover.
const HistoryPrompt = Codec.transform(Codec.array(Codec.fallback(Codec.undefinedOr(ContentPart), () => undefined)), {
  decode: (parts): Prompt => parts.filter((part) => part !== undefined),
  encode: (parts) => parts,
})
const HistoryEntry = Codec.struct({ prompt: HistoryPrompt, comments: Codec.lenientArray(PromptHistoryComment) })
export const PromptHistoryEntry = Codec.transform(Codec.union([HistoryEntry, HistoryPrompt]), {
  decode: (entry): typeof HistoryEntry.Type => ("prompt" in entry ? entry : { prompt: entry, comments: [] }),
  encode: (entry) => entry,
})
export type PromptHistoryEntry = typeof PromptHistoryEntry.Type

export const PromptHistoryState = Codec.struct({ entries: Codec.lenientArray(PromptHistoryEntry) })

