// TODO: Delete this contract when Session UI renders current Client messages directly.
export type PresentationFileDiff = {
  file?: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export type PresentationFileContent = {
  type: "text" | "binary"
  content: string
  encoding?: "base64"
  mimeType?: string
}

type MessageError = {
  name: string
  data?: {
    message?: unknown
  }
}

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string }
  summary?: { title?: string; diffs: PresentationFileDiff[] }
}

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  parentID: string
  time: { created: number; completed?: number }
  providerID: string
  modelID: string
  agent: string
  error?: MessageError
}

export type Message = UserMessage | AssistantMessage

type PartBase = {
  id: string
  sessionID: string
  messageID: string
}

export type TextPart = PartBase & {
  type: "text"
  text: string
  synthetic?: boolean
  metadata?: Record<string, unknown>
}

export type ReasoningPart = PartBase & {
  type: "reasoning"
  text: string
  metadata?: Record<string, unknown>
  time?: { start: number; end?: number }
}

type FilePartSourceText = {
  value: string
  start: number
  end: number
}

export type FilePartSource =
  | { type: "file"; text: FilePartSourceText; path: string }
  | {
      type: "symbol"
      text: FilePartSourceText
      path: string
      range: { start: { line: number; character: number }; end: { line: number; character: number } }
      name: string
      kind: number
    }
  | { type: "resource"; text: FilePartSourceText; clientName: string; uri: string }

export type FilePart = PartBase & {
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartSource
}

export type AgentPart = PartBase & {
  type: "agent"
  name?: string
  source?: { value?: string; start: number; end: number }
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw?: string }
  | {
      status: "running"
      input: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time?: { start: number }
    }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title?: string
      metadata?: Record<string, unknown>
      time?: { start: number; end: number; compacted?: number }
      attachments?: FilePart[]
    }
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      output?: string
      metadata?: Record<string, unknown>
      time?: { start: number; end: number }
    }

export type ToolPart = PartBase & {
  type: "tool"
  callID?: string
  tool: string
  state: ToolState
}

type PassivePart = PartBase & {
  type: "subtask" | "step-start" | "step-finish" | "snapshot" | "patch" | "retry" | "compaction"
}

export type Part = TextPart | ReasoningPart | FilePart | AgentPart | ToolPart | PassivePart

export type Todo = {
  content: string
  status: string
}

export type QuestionInfo = {
  question: string
}

export type QuestionAnswer = string[]
