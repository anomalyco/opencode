/**
 * ============================================================================
 * @ai-context/compressor - Core Type Definitions
 * ============================================================================
 *
 * Core types for the context compression library.
 */

/**
 * Message role types
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Message part types
 */
export type PartType = 'text' | 'tool' | 'file' | 'reasoning'

/**
 * Tool execution status
 */
export type ToolStatus = 'pending' | 'running' | 'completed' | 'error'

/**
 * Token usage statistics
 */
export interface TokenUsage {
  /** Input tokens (prompt + cached) */
  input: number
  /** Output tokens generated */
  output: number
  /** Tokens read from cache */
  cacheRead?: number
  /** Tokens written to cache */
  cacheWrite?: number
  /** Reasoning tokens (for extended thinking models) */
  reasoning?: number
}

/**
 * Base message interface
 */
export interface BaseMessage {
  /** Unique message identifier */
  id: string
  /** Message role */
  role: MessageRole
  /** Unix timestamp in milliseconds */
  timestamp: number
}

/**
 * User message
 */
export interface UserMessage extends BaseMessage {
  role: 'user'
  /** Message content */
  content: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Tool call part
 */
export interface ToolPart {
  type: 'tool'
  /** Tool name */
  name: string
  /** Tool input parameters */
  input: Record<string, unknown>
  /** Tool output (if completed) */
  output?: string
  /** Execution status */
  status: ToolStatus
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Compaction timestamp (if pruned) */
  compacted?: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Text content part
 */
export interface TextPart {
  type: 'text'
  /** Text content */
  content: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * File attachment part
 */
export interface FilePart {
  type: 'file'
  /** File URL or data URI */
  url: string
  /** MIME type */
  mime: string
  /** Optional filename */
  filename?: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Reasoning part (for extended thinking)
 */
export interface ReasoningPart {
  type: 'reasoning'
  /** Reasoning text */
  content: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Message part union type
 */
export type MessagePart = TextPart | ToolPart | FilePart | ReasoningPart

/**
 * Assistant message
 */
export interface AssistantMessage extends BaseMessage {
  role: 'assistant'
  /** Message parts */
  parts: MessagePart[]
  /** Token usage statistics */
  tokens?: TokenUsage
  /** Whether this is a summary message */
  summary?: boolean
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * System message
 */
export interface SystemMessage extends BaseMessage {
  role: 'system'
  /** System prompt content */
  content: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Message union type
 */
export type Message = UserMessage | AssistantMessage | SystemMessage

/**
 * Compression strategy type
 */
export type CompressionStrategy = 'truncate' | 'prune' | 'summarize' | 'none'

/**
 * Truncate strategy configuration
 */
export interface TruncateConfig {
  /** Enable truncate strategy */
  enabled: boolean
  /** Maximum number of messages to keep */
  maxMessages: number
}

/**
 * Prune strategy configuration
 */
export interface PruneConfig {
  /** Enable prune strategy */
  enabled: boolean
  /** Minimum tokens to save before pruning */
  minimumSavings: number
  /** Protect recent N tokens from pruning */
  protectRecent: number
  /** Protected tool names (e.g., ['skill', 'read']) */
  protectedTools: string[]
}

/**
 * Summarize strategy configuration
 */
export interface SummarizeConfig {
  /** Enable summarize strategy */
  enabled: boolean
  /** Maximum tokens for summary */
  maxTokens?: number
}

/**
 * Compression configuration
 */
export interface CompressionConfig {
  /** Maximum context window size */
  maxTokens: number
  /** Reserve tokens for output */
  outputReserve: number
  /** Truncate strategy */
  truncate?: TruncateConfig
  /** Prune strategy */
  prune?: PruneConfig
  /** Summarize strategy */
  summarize?: SummarizeConfig
}

/**
 * Compression result
 */
export interface CompressionResult {
  /** Strategy used */
  strategy: CompressionStrategy
  /** Tokens saved */
  tokensSaved: number
  /** Messages removed */
  messagesRemoved: number
  /** Generated summary (if summarize strategy) */
  summary?: string
}

/**
 * Compression options for compressMessages
 */
export interface CompressMessagesOptions {
  /** Override truncate config */
  truncate?: TruncateConfig
  /** Override prune config */
  prune?: PruneConfig
  /** Override summarize config */
  summarize?: SummarizeConfig
}
