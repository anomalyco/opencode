import { isAbsolute, resolve } from "node:path"
import type { ToolCall, ToolCallContent, ToolCallLocation, ToolCallUpdate, ToolKind } from "@agentclientprotocol/sdk"
import { readDisplayText } from "@opencode-ai/tui/mini/tool"

export type ToolInput = Record<string, unknown>
export type ToolContent = ReadonlyArray<
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
>

export function toToolKind(toolName: string): ToolKind {
  switch (toolName.toLocaleLowerCase()) {
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
    case "subagent":
      return "think"
    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: ToolInput, cwd?: string): ToolCallLocation[] {
  switch (toolName.toLocaleLowerCase()) {
    case "bash":
    case "shell": {
      const workdir = shellWorkdir(input, cwd)
      return workdir ? [{ path: workdir }] : []
    }
    case "read":
      return locationFrom(input.path)
    case "edit":
    case "write":
    case "patch":
    case "apply_patch":
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
  readonly state: { readonly input: ToolInput; readonly title?: string }
  readonly content?: ToolContent
  readonly cwd?: string
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "in_progress",
    kind: toToolKind(input.toolName),
    title: toolTitle(input.toolName, input.state.input, input.state.title),
    locations: toLocations(input.toolName, input.state.input, input.cwd),
    rawInput: rawInput(input.toolName, input.state.input, input.cwd),
    ...(input.content?.length ? { content: toolContent(input.content) } : {}),
  }
}

export function completedToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: ToolInput
  readonly content: ToolContent
  readonly metadata?: Readonly<Record<string, unknown>>
}): ToolCallUpdate {
  const normalized = toolContent(input.content)
  // Read's model content is a JSON page envelope; show the clean text instead.
  const firstText = input.content.find((part) => part.type === "text")
  const read = input.toolName.toLocaleLowerCase() === "read" && firstText ? readDisplayText(firstText.text) : undefined
  const images = normalized.filter((part) => part.type === "content" && part.content.type === "image")
  const primary =
    read === undefined
      ? normalized.filter((part) => !images.includes(part))
      : [{ type: "content" as const, content: { type: "text" as const, text: read } }]
  const oldText = stringValue(input.input.oldString)
  const newText = stringValue(input.input.newString)
  const diff: ToolCallContent[] =
    oldText === undefined || newText === undefined
      ? []
      : [
          {
            type: "diff",
            path: stringValue(input.input.path) ?? stringValue(input.input.filePath) ?? "",
            oldText,
            newText,
          },
        ]
  return {
    toolCallId: input.toolCallId,
    status: "completed",
    content: [...primary, ...diff, ...images],
    rawOutput: {
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  }
}

export function errorToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: ToolInput
  readonly content?: ToolContent
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly error: string
  readonly cwd?: string
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "failed",
    kind: toToolKind(input.toolName),
    title: toolTitle(input.toolName, input.input, undefined),
    locations: toLocations(input.toolName, input.input, input.cwd),
    rawInput: rawInput(input.toolName, input.input, input.cwd),
    content: [...toolContent(input.content ?? []), { type: "content", content: { type: "text", text: input.error } }],
    rawOutput: {
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      error: input.error,
    },
  }
}

function toolContent(content: ToolContent): ToolCallContent[] {
  return content.flatMap((part): ToolCallContent[] => {
    if (part.type === "text") return [{ type: "content", content: { type: "text", text: part.text } }]
    const match = /^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/.exec(part.uri)
    if (!match?.[1]?.startsWith("image/") || match[2] === undefined) return []
    return [{ type: "content", content: { type: "image", mimeType: match[1], data: match[2] } }]
  })
}

function toolTitle(toolName: string, input: ToolInput, fallback: string | undefined) {
  if (isShell(toolName)) return stringValue(input.command) ?? stringValue(input.cmd) ?? fallback ?? toolName
  return fallback || toolName
}

function rawInput(toolName: string, input: ToolInput, cwd?: string): ToolInput {
  if (!isShell(toolName) || input.cwd || input.workdir) return input
  const workdir = shellWorkdir(input, cwd)
  return workdir ? { ...input, cwd: workdir } : input
}

function shellWorkdir(input: ToolInput, cwd?: string) {
  const explicit = stringValue(input.workdir) ?? stringValue(input.cwd)
  if (!explicit) return cwd
  return isAbsolute(explicit) ? explicit : resolve(cwd ?? process.cwd(), explicit)
}

function isShell(toolName: string) {
  const tool = toolName.toLocaleLowerCase()
  return tool === "bash" || tool === "shell"
}

function locationFrom(...values: unknown[]): ToolCallLocation[] {
  return Array.from(
    new Set(
      values.flatMap((value): string[] => {
        if (Array.isArray(value))
          return value.filter((item): item is string => typeof item === "string" && item.length > 0)
        const path = stringValue(value)
        return path ? [path] : []
      }),
    ),
    (path) => ({ path }),
  )
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export * as ACPTool from "./tool"
