/**
 * Complete TypeScript types based on TUI Go SDK
 * Converted from packages/tui/sdk/session.go and event.go
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export type MessageRole = "user" | "assistant"

export interface MessageTime {
  created: number
  completed?: number
}

export interface MessagePath {
  cwd: string
  root: string
}

export interface MessageTokens {
  cache: MessageTokensCache
  input: number
  output: number
  reasoning: number
}

export interface MessageTokensCache {
  read: number
  write: number
}

export interface MessageError {
  data: any
  name: MessageErrorName
}

export type MessageErrorName =
  | "provider_auth_error"
  | "unknown_error"
  | "message_output_length_error"
  | "message_aborted_error"

export interface UserMessage {
  id: string
  role: "user"
  sessionID: string
  time: MessageTime
}

export interface AssistantMessage {
  id: string
  cost: number
  mode: string
  modelID: string
  path: MessagePath
  providerID: string
  role: "assistant"
  sessionID: string
  system: string[]
  time: MessageTime
  tokens: MessageTokens
  error?: MessageError
  summary?: boolean
}

export type Message = UserMessage | AssistantMessage

// ============================================================================
// PART TYPES
// ============================================================================

export type PartType = "text" | "file" | "tool" | "step_start" | "step_finish" | "snapshot" | "part_patch"

export interface PartBase {
  id: string
  messageID: string
  sessionID: string
  type: PartType
}

export interface TextPart extends PartBase {
  type: "text"
  text: string
  synthetic?: boolean
  time?: {
    created: number
  }
}

export interface FilePart extends PartBase {
  type: "file"
  filename: string
  mime: string
  hash?: string
  url?: string
  source: FilePartSource
}

export interface FilePartSource {
  type: "text" | "url" | "base64"
  text?: string
  url?: string
  base64?: string
}

export interface ToolPart extends PartBase {
  type: "tool"
  tool: string
  callID?: string
  state?: ToolPartState
}

export interface ToolPartState {
  status: "pending" | "running" | "completed" | "failed"
  data?: any
  error?: any
}

export interface StepStartPart extends PartBase {
  type: "step_start"
  tool: string
  callID: string
}

export interface StepFinishPart extends PartBase {
  type: "step_finish"
  tool: string
  callID: string
  cost?: number
  tokens?: {
    cache: {
      read: number
      write: number
    }
    input: number
    output: number
    reasoning: number
  }
}

export interface SnapshotPart extends PartBase {
  type: "snapshot"
  snapshot: string
  files?: string[]
}

export interface PartPatchPart extends PartBase {
  type: "part_patch"
  // Additional fields for part patches
}

export type Part = TextPart | FilePart | ToolPart | StepStartPart | StepFinishPart | SnapshotPart | PartPatchPart

// ============================================================================
// SSE EVENT TYPES
// ============================================================================

export type SSEEventType =
  | "installation.updated"
  | "lsp.client.diagnostics"
  | "message.updated"
  | "message.removed"
  | "message.part.updated"
  | "message.part.removed"
  | "storage.write"
  | "permission.updated"
  | "file.edited"
  | "session.updated"
  | "session.deleted"
  | "session.idle"
  | "session.error"
  | "server.connected"
  | "file.watcher.updated"
  | "ide.installed"

export interface SSEEventBase {
  type: SSEEventType
  properties: any
}

export interface MessageUpdatedEvent extends SSEEventBase {
  type: "message.updated"
  properties: {
    messageID: string
    sessionID: string
    message: Message
  }
}

export interface MessageRemovedEvent extends SSEEventBase {
  type: "message.removed"
  properties: {
    messageID: string
    sessionID: string
  }
}

export interface MessagePartUpdatedEvent extends SSEEventBase {
  type: "message.part.updated"
  properties: {
    messageID: string
    sessionID: string
    partID: string
    part: Part
  }
}

export interface MessagePartRemovedEvent extends SSEEventBase {
  type: "message.part.removed"
  properties: {
    messageID: string
    sessionID: string
    partID: string
  }
}

export interface SessionUpdatedEvent extends SSEEventBase {
  type: "session.updated"
  properties: {
    sessionID: string
    session: Session
  }
}

export interface SessionDeletedEvent extends SSEEventBase {
  type: "session.deleted"
  properties: {
    sessionID: string
  }
}

export interface SessionIdleEvent extends SSEEventBase {
  type: "session.idle"
  properties: {
    sessionID: string
  }
}

export interface SessionErrorEvent extends SSEEventBase {
  type: "session.error"
  properties: {
    sessionID: string
    error: MessageError
  }
}

export interface FileEditedEvent extends SSEEventBase {
  type: "file.edited"
  properties: {
    path: string
    content?: string
  }
}

export interface StorageWriteEvent extends SSEEventBase {
  type: "storage.write"
  properties: {
    key: string
    value: any
  }
}

export interface ServerConnectedEvent extends SSEEventBase {
  type: "server.connected"
  properties: Record<string, never>
}

export interface FileWatcherUpdatedEvent extends SSEEventBase {
  type: "file.watcher.updated"
  properties: {
    path: string
    event: string
  }
}

export interface InstallationUpdatedEvent extends SSEEventBase {
  type: "installation.updated"
  properties: {
    status: string
    progress?: number
  }
}

export interface LspClientDiagnosticsEvent extends SSEEventBase {
  type: "lsp.client.diagnostics"
  properties: {
    uri: string
    diagnostics: any[]
  }
}

export interface PermissionUpdatedEvent extends SSEEventBase {
  type: "permission.updated"
  properties: {
    permission: Permission
  }
}

export interface IdeInstalledEvent extends SSEEventBase {
  type: "ide.installed"
  properties: {
    ide: string
    version: string
  }
}

export type SSEEvent =
  | MessageUpdatedEvent
  | MessageRemovedEvent
  | MessagePartUpdatedEvent
  | MessagePartRemovedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | SessionIdleEvent
  | SessionErrorEvent
  | FileEditedEvent
  | StorageWriteEvent
  | ServerConnectedEvent
  | FileWatcherUpdatedEvent
  | InstallationUpdatedEvent
  | LspClientDiagnosticsEvent
  | PermissionUpdatedEvent
  | IdeInstalledEvent

// ============================================================================
// SESSION TYPES
// ============================================================================

export interface Session {
  id: string
  title: string
  created: number
  updated: number
  revert?: {
    messageID: string
  }
}

export interface Permission {
  id: string
  type: string
  granted: boolean
  data?: any
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface SendMessageRequest {
  providerID: string
  modelID: string
  mode?: string
  messageID?: string
  parts: SendMessagePart[]
}

export interface SendMessagePart {
  type: "text" | "file"
  text?: string
  filename?: string
  mime?: string
  source?: FilePartSource
}

export interface SessionMessagesResponse {
  messages: Message[]
  parts: Part[]
}

export interface SessionMessageResponse {
  message: Message
  parts: Part[]
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface MessageWithParts {
  message: Message
  parts: Part[]
}

export interface SessionState {
  id: string
  isActive: boolean
  isStreaming: boolean
  lastActivity: number
  error?: MessageError
}

export interface ChatMetrics {
  totalMessages: number
  totalCost: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
}
