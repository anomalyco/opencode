import { isAbsolute, resolve } from "path"
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
    case "apply_patch":
    case "patch":
    case "write":
      return "edit"

    case "grep":
    case "glob":
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"

    case "read":
      return "read"

    case "task":
      return "think"

    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: ToolInput, cwd?: string): ToolCallLocation[] {
  const tool = toolName.toLocaleLowerCase()

  switch (tool) {
    case "bash":
    case "shell": {
      const workdir = shellWorkdir(input, cwd)
      return workdir ? [{ path: workdir }] : []
    }

    case "read":
    case "edit":
    case "write":
      return locationFrom(input.filePath ?? input.filepath)

    case "external_directory":
      return locationFrom(input.filePath ?? input.filepath, input.parentDir, input.directories)

    case "grep":
    case "glob":
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return locationFrom(input.path)

    default:
      return []
  }
}

export function completedToolContent(toolName: string, state: CompletedToolState): ToolCallContent[] {
  const text =
    toolName.toLocaleLowerCase() === "read" ? (readDisplayText(state.metadata) ?? state.output) : state.output
  const content: ToolCallContent[] = [
    {
      type: "content",
      content: {
        type: "text",
        text,
      },
    },
  ]

  if (toToolKind(toolName) === "edit") {
    content.push(...diffContent(state.input))
  }

  content.push(...imageContents(state.attachments ?? []))
  return content
}

export function pendingToolCall(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: { readonly input: ToolInput; readonly title?: string }
  readonly cwd?: string
}): ToolCall {
  return {
    toolCallId: input.toolCallId,
    title: toolTitle(input.toolName, input.state.input, input.state.title),
    kind: toToolKind(input.toolName),
    status: "pending",
    locations: toLocations(input.toolName, input.state.input, input.cwd),
    rawInput: rawInput(input.toolName, input.state.input, input.cwd),
  }
}

export function runningToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: RunningToolState
  readonly output?: string
  readonly cwd?: string
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
    title: toolTitle(input.toolName, input.state.input, input.state.title),
    locations: toLocations(input.toolName, input.state.input, input.cwd),
    rawInput: rawInput(input.toolName, input.state.input, input.cwd),
    ...(content ? { content } : {}),
  }
}

export function duplicateRunningToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: RunningToolState
  readonly cwd?: string
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "in_progress",
    kind: toToolKind(input.toolName),
    title: toolTitle(input.toolName, input.state.input, input.state.title),
    locations: toLocations(input.toolName, input.state.input, input.cwd),
    rawInput: rawInput(input.toolName, input.state.input, input.cwd),
  }
}

export function completedToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: CompletedToolState & { readonly title?: string }
  readonly cwd?: string
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "completed",
    kind: toToolKind(input.toolName),
    title: toolTitle(input.toolName, input.state.input, input.state.title),
    locations: toLocations(input.toolName, input.state.input, input.cwd),
    content: completedToolContent(input.toolName, input.state),
    rawInput: rawInput(input.toolName, input.state.input, input.cwd),
    rawOutput: completedToolRawOutput(input.state),
  }
}

export function errorToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: ErrorToolState
  readonly cwd?: string
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "failed",
    kind: toToolKind(input.toolName),
    title: toolTitle(input.toolName, input.state.input, undefined),
    locations: toLocations(input.toolName, input.state.input, input.cwd),
    rawInput: rawInput(input.toolName, input.state.input, input.cwd),
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

// For shell tools, surface the actual command as the title so it stays visible
// before output lands; non-shell tools keep their model-provided title.
function toolTitle(toolName: string, input: ToolInput, fallback: string | undefined) {
  if (isShell(toolName)) return shellCommand(input) ?? stringValue(input.description) ?? fallback ?? toolName
  return fallback || toolName
}

// Enrich shell rawInput with the resolved working directory so clients can show
// where the command runs, unless the model already specified one.
function rawInput(toolName: string, input: ToolInput, cwd?: string): ToolInput {
  if (!isShell(toolName)) return input
  if (input.cwd || input.workdir) return input
  const workdir = shellWorkdir(input, cwd)
  return workdir ? { ...input, cwd: workdir } : input
}

function shellWorkdir(input: ToolInput, cwd?: string) {
  const explicit = stringValue(input.workdir) ?? stringValue(input.cwd)
  return resolvePath(explicit, cwd) ?? cwd
}

function resolvePath(value: string | undefined, cwd?: string) {
  if (!value) return undefined
  if (isAbsolute(value)) return value
  return resolve(cwd ?? process.cwd(), value)
}

function shellCommand(input: ToolInput) {
  return stringValue(input.command) ?? stringValue(input.cmd)
}

function isShell(toolName: string) {
  const tool = toolName.toLocaleLowerCase()
  return tool === "bash" || tool === "shell"
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

function locationFrom(...values: unknown[]): ToolCallLocation[] {
  return Array.from(
    new Set(
      values.flatMap((value): string[] => {
        if (Array.isArray(value)) {
          return value.filter((item): item is string => typeof item === "string" && item.length > 0)
        }
        const path = stringValue(value)
        return path ? [path] : []
      }),
    ),
    (path) => ({ path }),
  )
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

function readDisplayText(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined
  const display = (metadata as Record<string, unknown>).display
  if (!display || typeof display !== "object") return undefined
  const info = display as Record<string, unknown>
  if (info.type === "file") return stringValue(info.text)
  if (info.type === "directory" && Array.isArray(info.entries)) {
    return info.entries.filter((item): item is string => typeof item === "string").join("\n")
  }
  return undefined
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
