import type { ToolCallContent, ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk"

export type ToolInput = Record<string, unknown>

export type ToolAttachment = {
  readonly mime?: string
  readonly url?: string
  readonly [key: string]: unknown
}

export type CompletedToolState = {
  readonly status: "completed"
  readonly input: ToolInput
  readonly output: string
  readonly metadata?: unknown
  readonly attachments?: ReadonlyArray<ToolAttachment>
}

export type ImageAttachment = {
  readonly mimeType: string
  readonly data: string
}

export function toToolKind(toolName: string): ToolKind {
  const tool = toolName.toLocaleLowerCase()

  switch (tool) {
    case "bash":
    case "shell":
      return "execute"

    case "webfetch":
      return "fetch"

    case "edit":
    case "patch":
    case "write":
      return "edit"

    case "grep":
    case "glob":
    case "repo_clone":
    case "repo_overview":
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"

    case "read":
      return "read"

    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: ToolInput): ToolCallLocation[] {
  const tool = toolName.toLocaleLowerCase()

  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return locationFrom(input.filePath)

    case "grep":
    case "glob":
    case "repo_clone":
    case "repo_overview":
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return locationFrom(input.path)

    case "bash":
    case "shell":
      return []

    default:
      return []
  }
}

export function completedToolContent(toolName: string, state: CompletedToolState): ToolCallContent[] {
  const content: ToolCallContent[] = [
    {
      type: "content",
      content: {
        type: "text",
        text: state.output,
      },
    },
  ]

  if (toToolKind(toolName) === "edit") {
    content.push(...diffContent(state.input))
  }

  content.push(...imageContents(state.attachments ?? []))
  return content
}

export function completedToolRawOutput(state: CompletedToolState) {
  return {
    output: state.output,
    ...(state.metadata !== undefined ? { metadata: state.metadata } : {}),
    ...(state.attachments?.length ? { attachments: state.attachments } : {}),
  }
}

export function imageContents(attachments: ReadonlyArray<ToolAttachment>): ToolCallContent[] {
  return extractImageAttachments(attachments).map((attachment): ToolCallContent => {
    return {
      type: "content",
      content: {
        type: "image",
        mimeType: attachment.mimeType,
        data: attachment.data,
      },
    }
  })
}

export function extractImageAttachments(attachments: ReadonlyArray<ToolAttachment>): ImageAttachment[] {
  return attachments.flatMap((attachment): ImageAttachment[] => {
    const data = dataUrlImage(attachment)
    return data ? [data] : []
  })
}

export function shellOutputSnapshot(state: { readonly metadata?: unknown }) {
  if (!state.metadata || typeof state.metadata !== "object") return undefined
  return stringValue((state.metadata as Record<string, unknown>).output)
}

export const mapToolKind = toToolKind
export const extractLocations = toLocations
export const buildCompletedToolContent = completedToolContent
export const buildCompletedRawOutput = completedToolRawOutput
export const extractShellOutputSnapshot = shellOutputSnapshot

function locationFrom(value: unknown): ToolCallLocation[] {
  const path = stringValue(value)
  return path ? [{ path }] : []
}

function diffContent(input: ToolInput): ToolCallContent[] {
  const oldText = stringValue(input.oldString)
  const newText = stringValue(input.newString) ?? stringValue(input.content)
  if (oldText === undefined || newText === undefined) return []

  return [
    {
      type: "diff",
      path: stringValue(input.filePath) ?? "",
      oldText,
      newText,
    },
  ]
}

function dataUrlImage(attachment: ToolAttachment) {
  const match = stringValue(attachment.url)?.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/)
  const mime = match?.[1] ?? stringValue(attachment.mime)
  if (!mime?.startsWith("image/")) return undefined

  const data = match?.[2]
  if (data === undefined) return undefined
  return { mimeType: mime, data }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}
