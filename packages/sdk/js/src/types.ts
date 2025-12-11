/*
 * SessionMessage type that mimics the MessageV2.WithParts structure.
 * The SessionMessage type is exposed through the experimental.chat.messages.transform hook to allow
 * plugins to transform messages before they are converted into Vercel AI's
 * ModelMessage type.
 * */

export interface SessionMessagePartBase {
  id: string
  sessionID: string
  messageID: string
}

export interface SessionMessageFilePartSourceText {
  value: string
  start: number
  end: number
}

export interface SessionMessageFileSource {
  type: "file"
  path: string
  text: SessionMessageFilePartSourceText
}

export interface SessionMessageSymbolSource {
  type: "symbol"
  path: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  name: string
  kind: number
  text: SessionMessageFilePartSourceText
}

export type SessionMessageFilePartSource = SessionMessageFileSource | SessionMessageSymbolSource

export interface SessionMessageSnapshotPart extends SessionMessagePartBase {
  type: "snapshot"
  snapshot: string
}

export interface SessionMessagePatchPart extends SessionMessagePartBase {
  type: "patch"
  hash: string
  files: string[]
}

export interface SessionMessageTextPart extends SessionMessagePartBase {
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: {
    start: number
    end?: number
  }
  metadata?: Record<string, unknown>
}

export interface SessionMessageReasoningPart extends SessionMessagePartBase {
  type: "reasoning"
  text: string
  metadata?: Record<string, unknown>
  time: {
    start: number
    end?: number
  }
}

export interface SessionMessageFilePart extends SessionMessagePartBase {
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: SessionMessageFilePartSource
}

export interface SessionMessageAgentPart extends SessionMessagePartBase {
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export interface SessionMessageCompactionPart extends SessionMessagePartBase {
  type: "compaction"
  auto: boolean
}

export interface SessionMessageSubtaskPart extends SessionMessagePartBase {
  type: "subtask"
  prompt: string
  description: string
  agent: string
}

export interface SessionMessageRetryPart extends SessionMessagePartBase {
  type: "retry"
  attempt: number
  error: SessionMessageAPIError
  time: {
    created: number
  }
}

export interface SessionMessageStepStartPart extends SessionMessagePartBase {
  type: "step-start"
  snapshot?: string
}

export interface SessionMessageStepFinishPart extends SessionMessagePartBase {
  type: "step-finish"
  reason: string
  snapshot?: string
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}

export interface SessionMessageToolStatePending {
  status: "pending"
  input: Record<string, unknown>
  raw: string
}

export interface SessionMessageToolStateRunning {
  status: "running"
  input: Record<string, unknown>
  title?: string
  metadata?: Record<string, unknown>
  time: {
    start: number
  }
}

export interface SessionMessageToolStateCompleted {
  status: "completed"
  input: Record<string, unknown>
  output: string
  title: string
  metadata: Record<string, unknown>
  time: {
    start: number
    end: number
    compacted?: number
  }
  attachments?: SessionMessageFilePart[]
}

export interface SessionMessageToolStateError {
  status: "error"
  input: Record<string, unknown>
  error: string
  metadata?: Record<string, unknown>
  time: {
    start: number
    end: number
  }
}

export type SessionMessageToolState =
  | SessionMessageToolStatePending
  | SessionMessageToolStateRunning
  | SessionMessageToolStateCompleted
  | SessionMessageToolStateError

export interface SessionMessageToolPart extends SessionMessagePartBase {
  type: "tool"
  callID: string
  tool: string
  state: SessionMessageToolState
  metadata?: Record<string, unknown>
}

export type SessionMessagePart =
  | SessionMessageSnapshotPart
  | SessionMessagePatchPart
  | SessionMessageTextPart
  | SessionMessageReasoningPart
  | SessionMessageFilePart
  | SessionMessageAgentPart
  | SessionMessageCompactionPart
  | SessionMessageSubtaskPart
  | SessionMessageRetryPart
  | SessionMessageStepStartPart
  | SessionMessageStepFinishPart
  | SessionMessageToolPart

// Error types - uses NamedError structure { name, data }
export interface SessionMessageAPIError {
  name: "APIError"
  data: {
    message: string
    statusCode?: number
    isRetryable: boolean
    responseHeaders?: Record<string, string>
    responseBody?: string
  }
}

export interface SessionMessageAuthError {
  name: "ProviderAuthError"
  data: {
    providerID: string
    message: string
  }
}

export interface SessionMessageOutputLengthError {
  name: "MessageOutputLengthError"
  data: Record<string, never>
}

export interface SessionMessageAbortedError {
  name: "MessageAbortedError"
  data: {
    message: string
  }
}

export interface SessionMessageUnknownError {
  name: "UnknownError"
  data: {
    message: string
  }
}

export type SessionMessageContentError =
  | SessionMessageAPIError
  | SessionMessageAuthError
  | SessionMessageOutputLengthError
  | SessionMessageAbortedError
  | SessionMessageUnknownError

// File diff for summary
export interface SessionMessageFileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}

export interface SessionMessageUser {
  id: string
  sessionID: string
  role: "user"
  time: {
    created: number
  }
  summary?: {
    title?: string
    body?: string
    diffs: SessionMessageFileDiff[]
  }
  agent: string
  model: {
    providerID: string
    modelID: string
  }
  system?: string
  tools?: Record<string, boolean>
}

export interface SessionMessageAssistant {
  id: string
  sessionID: string
  role: "assistant"
  time: {
    created: number
    completed?: number
  }
  error?: SessionMessageContentError
  parentID: string
  modelID: string
  providerID: string
  mode: string
  path: {
    cwd: string
    root: string
  }
  summary?: boolean
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  finish?: string
}

export type SessionMessageInfo = SessionMessageUser | SessionMessageAssistant

export interface SessionMessage {
  info: SessionMessageInfo
  parts: SessionMessagePart[]
}
