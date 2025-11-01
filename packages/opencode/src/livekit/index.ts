/**
 * OpenCode LiveKit Integration
 *
 * Room-based voice collaboration with AI assistance
 */

export { RoomManager } from "./room-manager"
export { TranscriptionService, createTranscriptionService } from "./transcription"
export { OpenCodeRoomAgent, createRoomAgent } from "./room-agent"
export { ToolBridge, createToolBridge } from "./tool-bridge"

export type {
  // Configuration
  LiveKitConfig,
  RoomOptions,
  RoomConnectionState,
  AudioConfig,
  MicrophoneState,

  // Participants and Tracks
  Participant,
  AudioTrack,
  DataTrack,

  // Transcription
  TranscriptionConfig,
  TranscriptionResult,

  // Room Agent
  RoomAgentConfig,
  AgentCapabilities,
  ConversationNote,
  ConversationTodo,

  // Tool Bridge
  Tool,
  ToolParameter,
  ToolRegistry,
  ToolRequest,
  ToolResponse,
  ToolPermission,

  // Messages
  DataChannelMessage,
  ToolRequestMessage,
  ToolResponseMessage,
  ToolDiscoveryMessage,
  AgentStatusMessage,
  TranscriptionMessage,

  // Events
  RoomEvents,
  TranscriptionEvents,
  AgentEvents,

  // Errors
  LiveKitError,
  ToolExecutionError,
  TranscriptionError,
} from "./types"
