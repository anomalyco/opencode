/**
 * SDK Types for OpenCode Agent Sessions
 * Import core types from @opencode-ai/sdk/v2
 */
import type { Session, Message, Part, FileDiff, Model } from "@opencode-ai/sdk/v2"

// Re-export SDK types for convenience
export type { Session, Message, Part, FileDiff, Model }

/**
 * Sync data discriminated union type
 * Represents the different types of data that can be synchronized
 */
export type SyncData =
  | { type: "session"; data: Session }
  | { type: "message"; data: Message }
  | { type: "part"; data: Part }
  | { type: "session_diff"; data: FileDiff[] }
  | { type: "model"; data: Model[] }

/**
 * Complete agent session structure
 * This represents a fully reconstructed session from sync data
 */
export type SessionMetadata = {
  createdAt: number
  lastUpdated: number
  syncCount: number
  secret: string
  sessionID: string
}

/**
 * Lightweight index entry stored at index/${shareID}
 * Used by list endpoints to avoid loading full session blobs
 */
export type SessionIndex = {
  id: string
  sessionID: string
  title: string
  directory: string
  messageCount: number
  partCount: number
  diffCount: number
  modelCount: number
  lastUpdated: number
  syncCount: number
  createdAt: number
}

export type AgentSession = {
  session: Session
  messages: Message[]
  parts: Part[]
  diffs: FileDiff[]
  models: Model[]
  metadata: SessionMetadata
}

/**
 * Share credentials
 */
export type SyncInfo = {
  id: string
  url: string
  secret: string
}

export type ShareCredentials = SyncInfo & {
  sessionID: string
  createdAt: number
}

export type SecretNS = string
