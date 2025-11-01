/**
 * LiveKit Integration Types
 *
 * Core type definitions for OpenCode's simplified LiveKit room-based voice collaboration
 */

// ============================================================================
// Room Configuration
// ============================================================================

export interface LiveKitConfig {
  serverUrl: string
  apiKey: string
  apiSecret: string
  defaultRoomName?: string
}

export interface RoomOptions {
  name: string
  participantName?: string
  autoSubscribe?: boolean
  dynacast?: boolean
  adaptiveStream?: boolean
}

export interface RoomConnectionState {
  connected: boolean
  roomName?: string
  participantId?: string
  participantCount: number
  audioEnabled: boolean
  connectionError?: string
}

// ============================================================================
// Audio Configuration
// ============================================================================

export interface AudioConfig {
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  sampleRate: number
  channelCount: number
}

export interface MicrophoneState {
  enabled: boolean
  volume: number
  muted: boolean
  deviceId?: string
}

// ============================================================================
// Participant Types
// ============================================================================

export interface Participant {
  id: string
  identity: string
  name?: string
  metadata?: Record<string, any>
  isAgent: boolean
  isSpeaking: boolean
  audioTracks: AudioTrack[]
  dataTracks: DataTrack[]
  joinedAt: number
}

export interface AudioTrack {
  sid: string
  participantId: string
  enabled: boolean
  volume: number
}

export interface DataTrack {
  sid: string
  participantId: string
  label?: string
}

// ============================================================================
// Transcription Types
// ============================================================================

export interface TranscriptionConfig {
  provider: "browser" | "deepgram" | "openai"
  language: string
  interimResults: boolean
  continuousMode: boolean
}

export interface TranscriptionResult {
  text: string
  isFinal: boolean
  confidence: number
  speaker: string
  timestamp: number
}

// ============================================================================
// OpenCode Room Agent Types
// ============================================================================

export interface RoomAgentConfig {
  name: string
  roomName: string
  capabilities: AgentCapabilities
  model?: string
  agent?: string
}

export interface AgentCapabilities {
  transcribe: boolean
  takeNotes: boolean
  manageTodos: boolean
  answerQuestions: boolean
  executeTools: boolean
}

export interface ConversationNote {
  id: string
  timestamp: number
  speaker: string
  content: string
  type: "note" | "summary" | "decision" | "question"
  tags?: string[]
}

export interface ConversationTodo {
  id: string
  timestamp: number
  content: string
  assignee?: string
  priority: "low" | "medium" | "high"
  status: "pending" | "in_progress" | "completed"
  dueDate?: number
}

// ============================================================================
// Tool Bridge Types
// ============================================================================

export interface Tool {
  name: string
  description: string
  parameters: ToolParameter[]
  execute: (params: Record<string, any>) => Promise<any>
}

export interface ToolParameter {
  name: string
  type: "string" | "number" | "boolean" | "object" | "array"
  description: string
  required: boolean
  default?: any
}

export interface ToolRegistry {
  local: Tool[] // OpenCode's own tools
  external: Map<string, Tool[]> // External agent tools (agentId -> tools)
}

export interface ToolRequest {
  jsonrpc: "2.0"
  method: string
  params: {
    tool: string
    arguments: Record<string, any>
    sourceAgent?: string
  }
  id: string
}

export interface ToolResponse {
  jsonrpc: "2.0"
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
  id: string
}

export interface ToolPermission {
  agentId: string
  toolName: string
  granted: boolean
  grantedAt: number
  expiresAt?: number
}

// ============================================================================
// Data Channel Messages
// ============================================================================

export type DataChannelMessage =
  | ToolRequestMessage
  | ToolResponseMessage
  | ToolDiscoveryMessage
  | AgentStatusMessage
  | TranscriptionMessage

export interface ToolRequestMessage {
  type: "tool.request"
  payload: ToolRequest
}

export interface ToolResponseMessage {
  type: "tool.response"
  payload: ToolResponse
}

export interface ToolDiscoveryMessage {
  type: "tool.discovery"
  payload: {
    agentId: string
    tools: Array<{
      name: string
      description: string
      parameters: ToolParameter[]
    }>
  }
}

export interface AgentStatusMessage {
  type: "agent.status"
  payload: {
    agentId: string
    status: "active" | "idle" | "processing" | "error"
    capabilities: AgentCapabilities
    currentTask?: string
  }
}

export interface TranscriptionMessage {
  type: "transcription"
  payload: TranscriptionResult
}

// ============================================================================
// Event Types
// ============================================================================

export interface RoomEvents {
  connected: (state: RoomConnectionState) => void
  disconnected: (reason?: string) => void
  participantJoined: (participant: Participant) => void
  participantLeft: (participant: Participant) => void
  audioTrackSubscribed: (track: AudioTrack, participant: Participant) => void
  audioTrackUnsubscribed: (track: AudioTrack, participant: Participant) => void
  dataReceived: (message: DataChannelMessage, participant: Participant) => void
  speakingChanged: (participant: Participant, isSpeaking: boolean) => void
  error: (error: Error) => void
}

export interface TranscriptionEvents {
  interim: (result: TranscriptionResult) => void
  final: (result: TranscriptionResult) => void
  started: () => void
  stopped: () => void
  error: (error: Error) => void
}

export interface AgentEvents {
  noteCreated: (note: ConversationNote) => void
  todoCreated: (todo: ConversationTodo) => void
  todoUpdated: (todo: ConversationTodo) => void
  summaryGenerated: (summary: string) => void
  toolExecuted: (toolName: string, result: any) => void
  error: (error: Error) => void
}

// ============================================================================
// Error Types
// ============================================================================

export class LiveKitError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any,
  ) {
    super(message)
    this.name = "LiveKitError"
  }
}

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public toolName: string,
    public params: any,
  ) {
    super(message)
    this.name = "ToolExecutionError"
  }
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public provider: string,
  ) {
    super(message)
    this.name = "TranscriptionError"
  }
}
