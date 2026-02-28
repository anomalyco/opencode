// ACP Protocol Types

export interface ClientInfo {
  name: string
  version: string
}

export interface AgentInfo {
  name: string
  version: string
}

export interface ClientCapabilities {
  [key: string]: unknown
}

export interface AgentCapabilities {
  loadSession?: boolean
  mcpCapabilities?: {
    http?: boolean
    sse?: boolean
  }
  promptCapabilities?: {
    embeddedContext?: boolean
    image?: boolean
  }
  sessionCapabilities?: {
    fork?: Record<string, unknown>
    list?: Record<string, unknown>
    resume?: Record<string, unknown>
  }
}

export interface InitializeRequest {
  clientInfo: ClientInfo
  clientCapabilities?: ClientCapabilities
}

export interface InitializeResponse {
  protocolVersion: number
  agentCapabilities: AgentCapabilities
  agentInfo: AgentInfo
  authMethods?: AuthMethod[]
}

export interface AuthMethod {
  id: string
  name: string
  description?: string
  _meta?: {
    "terminal-auth"?: {
      command: string
      args: string[]
      label: string
    }
  }
}

export interface NewSessionRequest {
  cwd: string
  mcpServers?: McpServer[]
}

export interface NewSessionResponse {
  sessionId: string
  models?: ModelsInfo
  modes?: ModesInfo
  _meta?: Record<string, unknown>
}

export interface LoadSessionRequest {
  sessionId: string
  cwd: string
  mcpServers?: McpServer[]
}

export interface LoadSessionResponse {
  sessionId: string
  models?: ModelsInfo
  modes?: ModesInfo
  _meta?: Record<string, unknown>
}

export interface McpServer {
  name: string
  url?: string
  type?: string
  headers?: Array<{ name: string; value: string }>
  command?: string
  args?: string[]
  env?: Array<{ name: string; value: string }>
}

export interface ModelsInfo {
  currentModelId?: string
  availableModels?: ModelOption[]
}

export interface ModelOption {
  modelId: string
  name: string
  description?: string
}

export interface ModesInfo {
  currentModeId?: string
  availableModes?: ModeOption[]
}

export interface ModeOption {
  id: string
  name: string
  description?: string
}

export interface PromptRequest {
  sessionId: string
  prompt: PromptPart[]
}

export interface PromptResponse {
  stopReason: string
  usage?: UsageInfo
  _meta?: Record<string, unknown>
}

export interface UsageInfo {
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  thoughtTokens?: number
  cachedReadTokens?: number
  cachedWriteTokens?: number
}

export type PromptPart =
  | { type: "text"; text: string; annotations?: { audience?: string[] } }
  | { type: "image"; mimeType: string; data: string; uri?: string }
  | { type: "resource_link"; uri: string; name?: string }
  | {
      type: "resource"
      resource: {
        uri: string
        mimeType?: string
        text?: string
        blob?: string
      }
    }

export type SessionUpdate =
  | {
      sessionUpdate: "agent_message_chunk"
      content: { type: "text"; text: string }
    }
  | {
      sessionUpdate: "agent_thought_chunk"
      content: { type: "text"; text: string }
    }
  | {
      sessionUpdate: "user_message_chunk"
      content: { type: "text"; text: string }
    }
  | {
      sessionUpdate: "tool_call"
      toolCallId: string
      title: string
      kind: string
      status: "pending"
      locations: unknown[]
      rawInput: Record<string, unknown>
    }
  | {
      sessionUpdate: "tool_call_update"
      toolCallId: string
      status: "in_progress" | "completed" | "failed"
      kind?: string
      title?: string
      content?: Array<{
        type: "content" | "diff"
        content?: { type: "text"; text: string }
        path?: string
        oldText?: string
        newText?: string
      }>
      rawInput?: Record<string, unknown>
      rawOutput?: { output?: string; metadata?: unknown; error?: string }
    }
  | {
      sessionUpdate: "usage_update"
      used: number
      size: number
      cost?: { amount: number; currency: string }
    }
  | {
      sessionUpdate: "plan"
      entries: Array<{
        priority: string
        status: string
        content: string
      }>
    }
  | {
      sessionUpdate: "available_commands_update"
      availableCommands: Array<{ name: string; description: string }>
    }

export interface CancelNotification {
  sessionId: string
}

export enum AcpErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000,
  AuthRequired = -32001,
  SessionNotFound = -32002,
  SessionExpired = -32003,
  RateLimitExceeded = -32004,
}

export class AcpError extends Error {
  code: number
  data?: unknown

  constructor(message: string, code: number, data?: unknown) {
    super(message)
    this.name = "AcpError"
    this.code = code
    this.data = data
  }
}
