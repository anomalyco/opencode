import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"
import { createLegacyBlobReference } from "@/utils/draft-store"
import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { readPromptPresentation } from "./comment-note"

type Inline =
  | {
      type: "file"
      start: number
      end: number
      value: string
      path: string
      selection?: {
        startLine: number
        endLine: number
        startChar: number
        endChar: number
      }
    }
  | {
      type: "agent"
      start: number
      end: number
      value: string
      name: string
    }

function selectionFromFileUrl(url: string): Extract<Inline, { type: "file" }>["selection"] {
  const queryIndex = url.indexOf("?")
  if (queryIndex === -1) return undefined
  const params = new URLSearchParams(url.slice(queryIndex + 1))
  const startLine = Number(params.get("start"))
  const endLine = Number(params.get("end"))
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return undefined
  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}

export function extractPromptFromMessage(
  message: SessionMessageUser,
  opts?: { directory?: string; attachmentName?: string },
): Prompt {
  const text = readPromptPresentation(message.metadata)?.displayText ?? message.text
  const directory = opts?.directory
  const attachmentName = opts?.attachmentName ?? "attachment"
  const toRelative = (path: string) => {
    if (!directory) return path
    const prefix = directory.endsWith("/") ? directory : directory + "/"
    if (path.startsWith(prefix)) return path.slice(prefix.length)
    return path
  }
  const inline: Inline[] = []
  const images: ImageAttachmentPart[] = []
  for (const file of message.files ?? []) {
    const mention = file.mention
    const uri = file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`
    if (mention) {
      inline.push({
        type: "file",
        start: mention.start,
        end: mention.end,
        value: mention.text,
        path: toRelative(mention.text.startsWith("@") ? mention.text.slice(1) : mention.text),
        selection: selectionFromFileUrl(uri),
      })
      continue
    }
    const dataUrl =
      file.source.type === "uri" && file.source.uri.startsWith("data:")
        ? file.source.uri
        : file.data
          ? `data:${file.mime};base64,${file.data}`
          : undefined
    if (!dataUrl) continue
    images.push({
      type: "image",
      id: `${message.id}:file:${images.length}`,
      filename: file.name ?? attachmentName,
      mime: file.mime,
      blob: createLegacyBlobReference(dataUrl),
    })
  }
  for (const agent of message.agents ?? []) {
    const mention = agent.mention
    if (!mention) continue
    inline.push({
      type: "agent",
      start: mention.start,
      end: mention.end,
      value: mention.text,
      name: agent.name,
    })
  }
  return buildPrompt(text, inline, images)
}

export function extractPromptComments(message: SessionMessageUser) {
  return readPromptPresentation(message.metadata)?.comments ?? []
}

function buildPrompt(text: string, inline: Inline[], images: ImageAttachmentPart[]): Prompt {
  inline.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return a.end - b.end
  })

  const result: Prompt = []
  let position = 0
  let cursor = 0

  const pushText = (content: string) => {
    if (!content) return
    result.push({
      type: "text",
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  const pushFile = (item: Extract<Inline, { type: "file" }>) => {
    const content = item.value
    const attachment: FileAttachmentPart = {
      type: "file",
      path: item.path,
      content,
      start: position,
      end: position + content.length,
      selection: item.selection,
    }
    result.push(attachment)
    position += content.length
  }

  const pushAgent = (item: Extract<Inline, { type: "agent" }>) => {
    const content = item.value
    const mention: AgentPart = {
      type: "agent",
      name: item.name,
      content,
      start: position,
      end: position + content.length,
    }
    result.push(mention)
    position += content.length
  }

  for (const item of inline) {
    if (item.start < 0 || item.end < item.start) continue

    const expected = item.value
    if (!expected) continue

    const mismatch = item.end > text.length || item.start < cursor || text.slice(item.start, item.end) !== expected
    const start = mismatch ? text.indexOf(expected, cursor) : item.start
    if (start === -1) continue
    const end = mismatch ? start + expected.length : item.end

    pushText(text.slice(cursor, start))

    if (item.type === "file") pushFile(item)
    if (item.type === "agent") pushAgent(item)

    cursor = end
  }

  pushText(text.slice(cursor))

  if (result.length === 0) {
    result.push({ type: "text", content: "", start: 0, end: 0 })
  }

  if (images.length === 0) return result
  return [...result, ...images]
}
