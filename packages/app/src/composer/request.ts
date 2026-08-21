import { getFilename } from "@opencode-ai/util/path"
import type { FileSelection } from "@/workspaces/files/model"
import { encodeFilePath } from "@/workspaces/files/path"
import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt, SkillPart } from "@/composer/state"
import { formatCommentNote, type PromptComment } from "@/composer/comment-note"

// Network fields feed both boundaries; display fields keep desktop-only rendering details in the local echo.
type PromptRequest = {
  text: string
  displayText: string
  files: { uri: string; mime: string; name?: string; mention?: { start: number; end: number; text: string } }[]
  agents: { name: string; mention?: { start: number; end: number; text: string } }[]
  skills: { id: string; name: string; mention?: { start: number; end: number; text: string } }[]
  comments: PromptComment[]
}

type ContextFile = {
  key: string
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

type BuildPromptRequestInput = {
  prompt: Prompt
  context: ContextFile[]
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
  const context = input.context.flatMap((item) => {
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
    const mentions = parseCommentMentions(comment).flatMap((path) => {
      const uri = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
      if (used.has(uri)) return []
      used.add(uri)
      return [{ uri, mime: "text/plain", name: getFilename(path) }]
    })
    return [file, ...mentions]
  })

  const images = input.images.map((attachment) => ({
    uri: attachment.dataUrl,
    mime: attachment.mime,
    name: attachment.sourcePath ?? attachment.filename,
  }))

  return {
    text: [...(input.text.trim() ? [input.text] : []), ...comments.map(formatCommentNote)].join("\n"),
    displayText: input.text,
    files: [...files, ...context, ...images],
    agents,
    skills,
    comments,
  }
}
