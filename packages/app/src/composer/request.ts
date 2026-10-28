import { encodeFilePath, getFilename } from "@opencode/util/path"
import { parseSessionMention } from "@opencode/util/session-mention"
import { serializePrompt } from "./prompt-parts"
import type { FileSelection } from "@/workspaces/files/model"
import type {
  AgentPart,
  ContextItem,
  FileAttachmentPart,
  ImageAttachmentPart,
  NoteComment,
  NoteContextItem,
  PathAttachmentPart,
  Prompt,
  QuoteComment,
  QuoteContextItem,
  SkillPart,
} from "@/composer/state"
import {
  formatAttachmentReference,
  formatCommentNote,
  formatNoteComment,
  formatQuoteComment,
  type PromptAttachmentReference,
  type PromptComment,
} from "@/composer/comment-note"

// Network fields feed both boundaries; display fields keep desktop-only rendering details in the local echo.
type PromptRequest = {
  text: string
  displayText: string
  files: {
    uri: string
    mime: string
    name?: string
    description?: string
    mention?: { start: number; end: number; text: string }
  }[]
  agents: { name: string; mention?: { start: number; end: number; text: string } }[]
  skills: { id: string; name: string; mention?: { start: number; end: number; text: string } }[]
  comments: PromptComment[]
  attachments: PromptAttachmentReference[]
}

type BuildPromptRequestInput = {
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  images: (Omit<ImageAttachmentPart, "blob"> & { dataUrl: string })[]
  text: string
  sessionDirectory: string
}

const absolute = (directory: string, path: string) => {
  if (path.startsWith("/")) return path

  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path

  if (path.startsWith("\\\\") || path.startsWith("//")) return path

  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const fileQuery = (selection: FileSelection | undefined) =>
  selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""

const mention = /(^|[\s([{"'])@(\S+)/g

const parseCommentMentions = (comment: string) => {
  return Array.from(comment.matchAll(mention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")

    if (!path || parseSessionMention(`@${path}`)) return []

    return [path]
  })
}

const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart => part.type === "file"

const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"

const isSkillAttachment = (part: Prompt[number]): part is SkillPart => part.type === "skill"

const isPathAttachment = (part: Prompt[number]): part is PathAttachmentPart => part.type === "path"

/** The sent form of a note: its optional link and live subject travel only when present. */
export function noteComment(item: NoteContextItem, comment: string) {
  const note: NoteComment = {
    type: "note",
    origin: item.origin,
    label: item.label,
    icon: item.icon,
    subject: item.subject,
    comment,
  }

  if (item.href) note.href = item.href

  if (item.live) note.live = { ...item.live }

  return note
}

/** The sent form of a quote: its comment travels only when the user wrote one. */
export function quoteComment(item: QuoteContextItem) {
  const quote: QuoteComment = { type: "quote", text: item.text }
  const comment = item.comment?.trim()

  if (comment) quote.comment = comment

  if (item.source) quote.source = { ...item.source }

  return quote
}

export function buildPromptRequest(input: BuildPromptRequestInput): PromptRequest {
  const prompt = serializePrompt(input.prompt)

  const text = input.prompt.some((part) => part.type === "session")
    ? prompt.map((part) => ("content" in part ? part.content : "")).join("")
    : input.text

  const skills = prompt.filter(isSkillAttachment).map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mention: { start: attachment.start, end: attachment.end, text: attachment.content },
  }))

  const files = prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)

    return {
      uri: attachment.url ?? `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      mime: attachment.mime ?? "text/plain",
      name: attachment.filename ?? getFilename(attachment.path),
      description: attachment.description,
      mention: { start: attachment.start, end: attachment.end, text: attachment.content },
    }
  })

  const agents = prompt.filter(isAgentAttachment).map((attachment) => ({
    name: attachment.name,
    mention: { start: attachment.start, end: attachment.end, text: attachment.content },
  }))

  const used = new Set(files.map((file) => file.uri))
  const comments: PromptComment[] = []

  const mentioned = (comment: string) =>
    parseCommentMentions(comment).flatMap((path) => {
      const uri = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`

      if (used.has(uri)) return []
      used.add(uri)

      return [{ uri, mime: "text/plain", name: getFilename(path) }]
    })

  const context = input.context.flatMap((item) => {
    if (item.type === "note") {
      const comment = item.comment.trim()

      if (!comment) return []
      comments.push(noteComment(item, comment))

      return mentioned(comment)
    }

    if (item.type === "quote") {
      const quote = quoteComment(item)
      comments.push(quote)

      return quote.comment ? mentioned(quote.comment) : []
    }

    const path = absolute(input.sessionDirectory, item.path)
    const uri = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()

    if (!comment && used.has(uri)) return []
    used.add(uri)

    const file = { uri, mime: "text/plain", name: item.name ?? getFilename(item.path), description: item.description }

    if (!comment) return [file]

    comments.push({
      path: item.path,
      selection: item.selection,
      comment,
      preview: item.preview,
      origin: item.commentOrigin,
    })

    return [file, ...mentioned(comment)]
  })

  const inline = input.images.map((attachment) => ({
    uri: attachment.dataUrl,
    mime: attachment.mime,
    name: attachment.sourcePath ?? attachment.filename,
  }))

  // Like comments, path references reach the model as text and the message UI through metadata.
  const attachments = input.prompt
    .filter(isPathAttachment)
    .map((part) => ({ name: part.filename, mime: part.mime, path: part.path }))

  return {
    text: [
      ...(text.trim() ? [text] : []),
      ...attachments.map(formatAttachmentReference),
      ...comments.map((comment) => {
        if (comment.type === "note") return formatNoteComment(comment)

        if (comment.type === "quote") return formatQuoteComment(comment)

        return formatCommentNote(comment)
      }),
    ].join("\n"),
    displayText: text,
    files: [...files, ...context, ...inline],
    agents,
    skills,
    comments,
    attachments,
  }
}
