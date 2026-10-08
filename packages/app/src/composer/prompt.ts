import type { FileAttachmentPart, ImageAttachmentPart, PathAttachmentPart, Prompt } from "@/composer/state"
import { createLegacyBlobReference } from "@/runtime/persistence/drafts"
import type { SessionMessageUser } from "@opencode/client/promise"
import { commentContextItem, readPromptPresentation } from "./comment-note"
import { buildPromptRequest } from "./request"
import { contextItemKey, type FileContextItem } from "./schema"
import { createPathHelpers, decodeFilePath, stripFileProtocol, stripQueryAndHash } from "@/workspaces/files/path"
import { Skill } from "@opencode/schema/skill"

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
      url?: string
      mime?: string
      filename?: string
      description?: string
    }
  | {
      type: "agent"
      start: number
      end: number
      value: string
      name: string
    }
  | {
      type: "skill"
      start: number
      end: number
      value: string
      id: Skill.ID
      name: Skill.Name
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

// A user message or a pending inbox item: the materialized transcript row shares the inbox payload's shape.
export type PromptSource = Pick<SessionMessageUser, "id" | "text" | "files" | "agents" | "skills" | "metadata">

// Restores the composer content that produced a prompt, losing nothing it carried. File references
// without a mention return as context through extractPromptContext; unmentioned agents and skills
// return as trailing mentions, and inline files as attachments.
export function extractPromptFromMessage(
  message: PromptSource,
  opts?: { directory?: string; attachmentName?: string },
): Prompt {
  const presentation = readPromptPresentation(message.metadata)
  const text = presentation?.displayText ?? message.text
  const directory = opts?.directory
  const attachmentName = opts?.attachmentName ?? "attachment"

  const toRelative = (path: string) => {
    if (!directory) return path
    const prefix = directory.endsWith("/") ? directory : directory + "/"

    if (path.startsWith(prefix)) return path.slice(prefix.length)

    return path
  }

  const inline: Inline[] = []
  const trailing: Inline[] = []
  const attachments: (ImageAttachmentPart | PathAttachmentPart)[] = []

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
        url: uri,
        mime: file.mime,
        filename: file.name,
        description: file.description,
      })
      continue
    }

    // A file reference returns as a context chip through extractPromptContext.
    if (file.source.type === "uri" && file.source.uri.startsWith("file:")) continue

    // Stored files carry their bytes, and an empty file has empty data; only a local handoff row
    // leaves data empty because its bytes live at a blob URL.
    const stored = file.source.type === "inline" || !!file.data

    const dataUrl =
      file.source.type === "uri" && file.source.uri.startsWith("data:")
        ? file.source.uri
        : stored
          ? `data:${file.mime};base64,${file.data}`
          : undefined

    if (!dataUrl) continue
    attachments.push({
      type: "image",
      id: `${message.id}:file:${attachments.length}`,
      filename: file.name ?? attachmentName,
      mime: file.mime,
      blob: createLegacyBlobReference(dataUrl),
    })
  }

  for (const agent of message.agents ?? []) {
    const mention = agent.mention
    const part = { type: "agent" as const, name: agent.name }

    if (!mention) trailing.push({ ...part, start: -1, end: -1, value: `@${agent.name}` })

    if (mention) inline.push({ ...part, start: mention.start, end: mention.end, value: mention.text })
  }

  for (const attached of message.skills ?? []) {
    const mention = attached.mention
    const part = { type: "skill" as const, id: Skill.ID.make(attached.id), name: Skill.Name.make(attached.name) }

    if (!mention) trailing.push({ ...part, start: -1, end: -1, value: `@${attached.id}` })

    if (mention) inline.push({ ...part, start: mention.start, end: mention.end, value: mention.text })
  }

  attachments.push(
    ...(presentation?.attachments ?? []).map(
      (file, index): PathAttachmentPart => ({
        type: "path",
        id: `${message.id}:path:${index}`,
        filename: file.name,
        mime: file.mime,
        path: file.path,
      }),
    ),
  )

  return buildPrompt(text, inline, trailing, attachments)
}

/**
 * The composer context a sent prompt restores: its comments, and the files it attached without a mention. Like the
 * TUI, an unmentioned file keeps its URI rather than becoming text; comment files are regenerated from the comments.
 */
export function extractPromptContext(message: PromptSource, opts?: { directory?: string }) {
  const comments = (readPromptPresentation(message.metadata)?.comments ?? []).map(commentContextItem)
  const directory = opts?.directory

  const regenerated = new Set(
    buildPromptRequest({
      prompt: [],
      context: comments.map((item) => ({ ...item, key: contextItemKey(item) })),
      images: [],
      text: "",
      sessionDirectory: directory ?? "",
    }).files.map((file) => file.uri),
  )

  const files = (message.files ?? []).flatMap((file): FileContextItem[] => {
    if (file.mention || file.source.type !== "uri" || !file.source.uri.startsWith("file:")) return []

    if (regenerated.has(file.source.uri)) return []

    const absolute = decodeFilePath(stripQueryAndHash(stripFileProtocol(file.source.uri))).replace(
      /^\/([A-Za-z]:)/,
      "$1",
    )

    return [
      {
        type: "file",
        // The workspace root itself has no relative path, so it keeps its absolute one.
        path: (directory && createPathHelpers(() => directory).normalize(file.source.uri)) || absolute,
        selection: selectionFromFileUrl(file.source.uri),
        name: file.name,
        description: file.description,
      },
    ]
  })

  return { comments, files }
}

function buildPrompt(
  text: string,
  inline: Inline[],
  trailing: Inline[],
  attachments: (ImageAttachmentPart | PathAttachmentPart)[],
): Prompt {
  inline.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start

    return a.end - b.end
  })

  const result: Prompt = []
  let position = 0
  let cursor = 0
  let tail = ""

  const pushText = (content: string) => {
    if (!content) return
    result.push({
      type: "text",
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
    tail = content
  }

  const pushPart = (item: Inline) => {
    const content = item.value
    const span = { content, start: position, end: position + content.length }
    position += content.length
    tail = content

    if (item.type === "agent") {
      result.push({ type: "agent", name: item.name, ...span })

      return
    }

    if (item.type === "skill") {
      result.push({ type: "skill", id: item.id, name: item.name, ...span })

      return
    }

    result.push({
      type: "file",
      path: item.path,
      selection: item.selection,
      url: item.url,
      mime: item.mime,
      filename: item.filename,
      description: item.description,
      ...span,
    } satisfies FileAttachmentPart)
  }

  // A mention whose recorded offsets no longer index the text (another client may count
  // display width) is found by its text; one missing from the text returns at the end.
  const unplaced = inline.flatMap((item) => {
    if (!item.value) return []

    const mismatch =
      item.start < cursor ||
      item.end < item.start ||
      item.end > text.length ||
      text.slice(item.start, item.end) !== item.value

    const start = mismatch ? text.indexOf(item.value, cursor) : item.start

    if (start === -1) return [item]
    pushText(text.slice(cursor, start))
    pushPart(item)
    cursor = start + item.value.length

    return []
  })

  pushText(text.slice(cursor))

  for (const item of [...unplaced, ...trailing]) {
    if (tail && !/\s$/.test(tail)) pushText(" ")
    pushPart(item)
  }

  if (result.length === 0) {
    result.push({ type: "text", content: "", start: 0, end: 0 })
  }

  return [...result, ...attachments]
}
