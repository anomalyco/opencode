import type { EventSubscribeOutput, FileDiffInfo, ProjectListOutput } from "@opencode-ai/client/promise"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"

export type Project = Omit<ProjectListOutput[number], "canonical"> & { worktree: string }

type CurrentEvent = EventSubscribeOutput extends infer Item
  ? Item extends { type: infer Type extends string; data: infer Data }
    ? { type: Type; properties: Data }
    : never
  : never

export type Event = CurrentEvent

export type EventSessionError = Extract<Event, { type: "session.execution.failed" }>

type MessageError =
  | { name: "ProviderAuthError"; data: { providerID: string; message: string } }
  | { name: "UnknownError"; data: { message: string; ref?: string } }
  | { name: "MessageOutputLengthError"; data: Record<string, unknown> }
  | { name: "MessageAbortedError"; data: { message: string } }
  | { name: "StructuredOutputError"; data: { message: string; retries: number } }
  | { name: "ContextOverflowError"; data: { message: string; responseBody?: string } }
  | { name: "ContentFilterError"; data: { message: string } }
  | {
      name: "APIError"
      data: {
        message: string
        statusCode?: number
        isRetryable: boolean
        responseHeaders?: Record<string, string>
        responseBody?: string
        metadata?: Record<string, string>
      }
    }

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  format?: { type: "text" } | { type: "json_schema"; schema: Record<string, unknown>; retryCount?: number }
  summary?: { title?: string; body?: string; diffs: FileDiffInfo[] }
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  system?: string
  tools?: Record<string, boolean>
}

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number }
  error?: MessageError
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: { cwd: string; root: string }
  summary?: boolean
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  structured?: unknown
  variant?: string
  finish?: string
}

export type Message = UserMessage | AssistantMessage

type PartBase = { id: string; sessionID: string; messageID: string }

export type TextPart = PartBase & {
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: { start: number; end?: number }
  metadata?: Record<string, unknown>
}

type FilePartSourceText = { value: string; start: number; end: number }
type FileSource = { text: FilePartSourceText; type: "file"; path: string }
type SymbolSource = {
  text: FilePartSourceText
  type: "symbol"
  path: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  name: string
  kind: number
}
type ResourceSource = { text: FilePartSourceText; type: "resource"; clientName: string; uri: string }

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export type FilePart = PartBase & {
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | {
      status: "running"
      input: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number }
    }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata: Record<string, unknown>
      time: { start: number; end: number; compacted?: number }
      attachments?: FilePart[]
    }
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }

export type ToolPart = PartBase & {
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: Record<string, unknown>
}

export type AgentPart = PartBase & {
  type: "agent"
  name: string
  source?: { value: string; start: number; end: number }
}

type ReasoningPart = PartBase & {
  type: "reasoning"
  text: string
  metadata?: Record<string, unknown>
  time: { start: number; end?: number }
}

type SubtaskPart = PartBase & {
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: { providerID: string; modelID: string }
  command?: string
}

type StepStartPart = PartBase & { type: "step-start"; snapshot?: string }
type StepFinishPart = PartBase & {
  type: "step-finish"
  reason: string
  snapshot?: string
  cost: number
  tokens: AssistantMessage["tokens"]
}
type SnapshotPart = PartBase & { type: "snapshot"; snapshot: string }
type PatchPart = PartBase & { type: "patch"; hash: string; files: string[] }
type RetryPart = PartBase & {
  type: "retry"
  attempt: number
  error: Extract<MessageError, { name: "APIError" }>
  time: { created: number }
}
type CompactionPart = PartBase & {
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

export type Todo = {
  content: string
  status: string
  priority: string
}

export type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export type FileContent = {
  type: "text" | "binary"
  content: string
  diff?: string
  patch?: {
    oldFileName: string
    newFileName: string
    oldHeader?: string
    newHeader?: string
    hunks: Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      lines: string[]
    }>
    index?: string
  }
  encoding?: "base64"
  mimeType?: string
}

export type Path = {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

export type VcsInfo = { branch?: string; default_branch?: string }
export type LspStatus = { id: string; name: string; root: string; status: "connected" | "error" }

export type Agent = {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>
  model?: { modelID: string; providerID: string }
  variant?: string
  prompt?: string
  options: Record<string, unknown>
  steps?: number
}

export type Provider = NormalizedProviderListResponse["all"] extends Map<string, infer Item> ? Item : never
export type Model = Provider["models"][string]
export type ProviderListResponse = NormalizedProviderListResponse

export type ProviderAuthResponse = Record<string, unknown>

export type Config = {
  model?: string
  small_model?: string
  default_agent?: string
  username?: string
  share?: "manual" | "auto" | "disabled"
  autoshare?: boolean
  shell?: string
  plugin?: Array<string | [string, Record<string, unknown>]>
  provider?: Record<string, { npm?: string; models?: Record<string, unknown> }>
  mcp?: Record<string, unknown>
  agent?: Record<string, unknown>
  command?: Record<string, unknown>
  instructions?: string[]
  disabled_providers?: string[]
  enabled_providers?: string[]
  permission?: string | Record<string, unknown>
  tools?: Record<string, boolean>
  experimental?: Record<string, unknown>
  [key: string]: unknown
}
