import { isAbsolute, resolve } from "node:path"
import type { ToolCall, ToolCallContent, ToolCallLocation, ToolCallUpdate, ToolKind } from "@agentclientprotocol/sdk"
import type { Tool } from "@opencode/schema/tool"
import { readDisplayText } from "@opencode/tui/mini/tool"
import { Patch } from "@opencode/util/patch"
import { Result } from "effect"

export type ToolInput = Record<string, unknown>

export type DiffSource = {
  readonly toolName: string
  readonly input: ToolInput
  readonly metadata?: Readonly<Record<string, unknown>>
}

function toToolKind(toolName: string): ToolKind {
  switch (canonicalName(toolName)) {
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
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"
    case "read":
      return "read"
    case "subagent":
      return "think"
    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: ToolInput, cwd: string): ToolCallLocation[] {
  switch (canonicalName(toolName)) {
    case "shell":
      return locationFrom(cwd, stringValue(input.workdir) ?? stringValue(input.cwd) ?? cwd)
    case "read":
    case "edit":
    case "write":
      return locationFrom(cwd, filePath(input))
    case "patch":
      return locationFrom(
        cwd,
        ...patchHunks(input).flatMap((hunk) => [hunk.path, hunk.type === "update" ? hunk.movePath : undefined]),
      )
    case "external_directory":
      return locationFrom(cwd, input.filepath)
    case "grep":
    case "glob":
    case "context":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return locationFrom(cwd, input.path)
    default:
      return []
  }
}

export function pendingToolCall(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly state: { readonly input: ToolInput; readonly title?: string }
  readonly cwd: string
}): ToolCall {
  return {
    toolCallId: input.toolCallId,
    name: input.toolName,
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
  readonly state: { readonly input: ToolInput }
  readonly cwd: string
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "in_progress",
    kind: toToolKind(input.toolName),
    title: toolTitle(input.toolName, input.state.input),
    locations: toLocations(input.toolName, input.state.input, input.cwd),
    rawInput: rawInput(input.toolName, input.state.input, input.cwd),
  }
}

export function completedToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: ToolInput
  readonly content: ReadonlyArray<Tool.Content>
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly cwd: string
}): ToolCallUpdate {
  const normalized = toolContent(input.content)
  const firstText = input.content.find((part) => part.type === "text")
  const read = canonicalName(input.toolName) === "read" && firstText ? readDisplayText(firstText.text) : undefined
  const images = normalized.filter((part) => part.type === "content" && part.content.type === "image")
  const primary =
    read === undefined
      ? normalized.filter((part) => !images.includes(part))
      : [{ type: "content" as const, content: { type: "text" as const, text: read } }]
  return {
    toolCallId: input.toolCallId,
    status: "completed",
    locations: toLocations(input.toolName, input.input, input.cwd),
    content: [...primary, ...images],
    rawOutput: {
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  }
}

export function errorToolUpdate(input: {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: ToolInput
  readonly content?: ReadonlyArray<Tool.Content>
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly error: string
  readonly cwd: string
}): ToolCallUpdate {
  return {
    toolCallId: input.toolCallId,
    status: "failed",
    kind: toToolKind(input.toolName),
    title: toolTitle(input.toolName, input.input),
    locations: toLocations(input.toolName, input.input, input.cwd),
    rawInput: rawInput(input.toolName, input.input, input.cwd),
    content: [...toolContent(input.content ?? []), { type: "content", content: { type: "text", text: input.error } }],
    rawOutput: {
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      error: input.error,
    },
  }
}

function toolContent(content: ReadonlyArray<Tool.Content>): ToolCallContent[] {
  return content.flatMap((part): ToolCallContent[] => {
    if (part.type === "text") return [{ type: "content", content: { type: "text", text: part.text } }]
    const match = /^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/.exec(part.uri)
    if (!match?.[1]?.startsWith("image/") || match[2] === undefined) return []
    return [{ type: "content", content: { type: "image", mimeType: match[1], data: match[2] } }]
  })
}

function toolTitle(toolName: string, input: ToolInput, fallback?: string) {
  if (isShell(toolName)) return stringValue(input.command) ?? stringValue(input.cmd) ?? fallback ?? toolName
  return fallback || toolName
}

function rawInput(toolName: string, input: ToolInput, cwd: string): ToolInput {
  if (!isShell(toolName) || input.cwd || input.workdir) return input
  return { ...input, cwd }
}

function isShell(toolName: string) {
  return canonicalName(toolName) === "shell"
}

function locationFrom(cwd: string, ...values: unknown[]): ToolCallLocation[] {
  return Array.from(
    new Set(values.flatMap((value) => (typeof value === "string" && value ? [absolutePath(value, cwd)] : []))),
    (path) => ({ path }),
  )
}

const V1Aliases = new Map([
  ["bash", "shell"],
  ["task", "subagent"],
  ["apply_patch", "patch"],
])

export function canonicalName(toolName: string) {
  const name = toolName.toLocaleLowerCase()
  return V1Aliases.get(name) ?? name
}

// Sessions migrated from V1 keep their original `filePath` tool inputs.
export function filePath(input: ToolInput) {
  return stringValue(input.path) ?? stringValue(input.filePath)
}

export function patchHunks(input: ToolInput) {
  const patchText = stringValue(input.patchText)
  if (!patchText) return []
  const parsed = Patch.parse(patchText)
  return Result.isSuccess(parsed) ? parsed.success : []
}

export function absolutePath(path: string, cwd: string) {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}
