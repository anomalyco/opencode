import type { Skill } from "@opencode/schema/skill"
import { encodeFilePath, getFilename } from "@opencode/util/path"
import type { FileSelection } from "@/workspaces/files/model"
import type {
  AgentPart,
  ContextItem,
  FileAttachmentPart,
  ImageAttachmentPart,
  PathAttachmentPart,
  Prompt,
  SkillPart,
} from "@/composer/state"
import {
  formatAttachmentReference,
  formatCommentNote,
  formatNoteComment,
  type PromptAttachmentReference,
  type PromptComment,
} from "@/composer/comment-note"

// Network fields feed both boundaries; display fields keep desktop-only rendering details in the local echo.
type PromptRequest = {
  text: string
  displayText: string
  files: { uri: string; mime: string; name?: string; mention?: { start: number; end: number; text: string } }[]
  agents: { name: string; mention?: { start: number; end: number; text: string } }[]
  skills: { id: Skill.ID; name: string; mention?: { start: number; end: number; text: string } }[]
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
    if (!path) return []
    return [path]
  })
}

const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart => part.type === "file"
const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"
const isSkillAttachment = (part: Prompt[number]): part is SkillPart => part.type === "skill"
const isPathAttachment = (part: Prompt[number]): part is PathAttachmentPart => part.type === "path"

export function buildPromptRequest(input: BuildPromptRequestInput): PromptRequest {
  const skills = input.prompt.filter(isSkillAttachment).map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mention: { start: attachment.start, end: attachment.end, text: attachment.content },
  }))
  const files = input.prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)
    return {
      uri: attachment.url ?? `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      mime: attachment.mime ?? "text/plain",
      name: attachment.filename ?? getFilename(attachment.path),
      mention: { start: attachment.start, end: attachment.end, text: attachment.content },
    }
  })

  const agents = input.prompt.filter(isAgentAttachment).map((attachment) => ({
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
      comments.push({
        type: "note",
        origin: item.origin,
        label: item.label,
        icon: item.icon,
        subject: item.subject,
        ...(item.href ? { href: item.href } : {}),
        ...(item.live ? { live: { ...item.live } } : {}),
        comment,
      })
      return mentioned(comment)
    }
    const path = absolute(input.sessionDirectory, item.path)
    const uri = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()
    if (!comment && used.has(uri)) return []
    used.add(uri)

    const file = { uri, mime: "text/plain", name: getFilename(item.path) }
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
      ...(input.text.trim() ? [input.text] : []),
      ...attachments.map(formatAttachmentReference),
      ...comments.map((comment) => (comment.type === "note" ? formatNoteComment(comment) : formatCommentNote(comment))),
    ].join("\n"),
    displayText: input.text,
    files: [...files, ...context, ...inline],
    agents,
    skills,
    comments,
    attachments,
  }
}
