import type { ToolCall, ToolCallContent, ToolCallLocation, ToolCallUpdate, ToolKind } from "@agentclientprotocol/sdk"

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

export type RunningToolState = {
  readonly status: "running"
  readonly input: ToolInput
  readonly title?: string
}

export type ErrorToolState = {
  readonly status: "error"
  readonly input: ToolInput
  readonly error: string
  readonly metadata?: unknown
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
      return locationFrom(input.filePath ?? input.filepath)

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

export function pendingToolCall(input: { readonly toolCallId: string; readonly toolName: string }): ToolCall {
  return {
    toolCallId: input.toolCallId,
    title: input.toolName,
    kind: toToolKind(input.toolName),
    status: "pending",
    locations: [],
    rawInput: {},
  }
}

export function runningToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: RunningToolState
  readonly output?: string
}): ToolCallUpdate {
  const content = input.output
    ? [
        {
          type: "content" as const,
          content: {
            type: "text" as const,
            text: input.output,
          },
        },
      ]
    : undefined

  return {
    toolCallId: input.toolCallId,
    status: "in_progress",
    kind: toToolKind(input.toolName),
    title: input.state.title ?? input.toolName,
    locations: toLocations(input.toolName, input.state.input),
    rawInput: input.state.input,
    ...(content ? { content } : {}),
  }
}

export function duplicateRunningToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: RunningToolState
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "in_progress",
    kind: toToolKind(input.toolName),
    title: input.state.title ?? input.toolName,
    locations: toLocations(input.toolName, input.state.input),
    rawInput: input.state.input,
  }
}

export function completedToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: CompletedToolState & { readonly title: string }
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "completed",
    kind: toToolKind(input.toolName),
    title: input.state.title,
    content: completedToolContent(input.toolName, input.state),
    rawInput: input.state.input,
    rawOutput: completedToolRawOutput(input.state),
  }
}

export function errorToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: ErrorToolState
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "failed",
    kind: toToolKind(input.toolName),
    title: input.toolName,
    rawInput: input.state.input,
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: input.state.error,
        },
      },
    ],
    rawOutput: {
      error: input.state.error,
      metadata: input.state.metadata,
    },
  }
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
export const buildPendingToolCall = pendingToolCall
export const buildRunningToolUpdate = runningToolUpdate
export const buildDuplicateRunningToolUpdate = duplicateRunningToolUpdate
export const buildCompletedToolUpdate = completedToolUpdate
export const buildErrorToolUpdate = errorToolUpdate

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
