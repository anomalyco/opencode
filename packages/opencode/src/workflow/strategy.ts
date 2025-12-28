import type { MessageV2 } from "@/session/message-v2"
import type { Session } from "@/session"
import type { Provider } from "@/provider/provider"

export namespace WorkflowStrategy {
  /**
   * Core interface that every workflow strategy must implement
   */
  export interface Strategy {
    /** Unique identifier for this workflow type */
    readonly id: string

    /** Human-readable name */
    readonly name: string

    /** Description for users */
    readonly description: string

    /** Metadata for this workflow instance */
    readonly metadata: WorkflowMetadata

    // === Lifecycle Hooks ===

    /**
     * Called when a new session is created with this workflow
     */
    onCreate(input: OnCreateInput): Promise<OnCreateOutput>

    /**
     * Called when a user message is added
     */
    onMessage(input: OnMessageInput): Promise<OnMessageOutput>

    /**
     * Called before processing assistant response
     */
    beforeProcess(input: BeforeProcessInput): Promise<BeforeProcessOutput>

    /**
     * Called after assistant completes
     */
    afterProcess(input: AfterProcessInput): Promise<AfterProcessOutput>

    /**
     * Called when session is forked (optional)
     */
    onFork?(input: OnForkInput): Promise<OnForkOutput>

    /**
     * Called when branches are merged (optional)
     */
    onMerge?(input: OnMergeInput): Promise<OnMergeOutput>

    // === Context Management ===

    /**
     * Build the message context for LLM
     * This is the core differentiator between workflows
     */
    buildContext(input: BuildContextInput): Promise<BuildContextOutput>

    /**
     * Decide if compaction is needed
     */
    shouldCompact(input: ShouldCompactInput): Promise<boolean>

    /**
     * Handle compaction (may be workflow-specific)
     */
    handleCompaction(input: HandleCompactionInput): Promise<HandleCompactionOutput>

    // === Message Retrieval ===

    /**
     * Get messages for display in UI
     */
    getMessagesForDisplay(input: GetMessagesInput): Promise<MessageV2.WithParts[]>

    /**
     * Get messages for a specific context/branch
     */
    getMessagesForContext(input: GetContextMessagesInput): Promise<MessageV2.WithParts[]>

    // === Storage ===

    /**
     * Save workflow-specific state
     */
    saveState(sessionID: string): Promise<void>

    /**
     * Load workflow-specific state
     */
    loadState(sessionID: string): Promise<void>
  }

  // === Type Definitions ===

  export interface WorkflowMetadata {
    /** Strategy-specific configuration */
    config: Record<string, any>

    /** Strategy-specific state */
    state: Record<string, any>

    /** Version for migration */
    version: number
  }

  export interface OnCreateInput {
    sessionID: string
    projectID: string
    directory: string
    parentSession?: Session.Info
  }

  export interface OnCreateOutput {
    /** Additional session metadata to store */
    metadata?: Record<string, any>
  }

  export interface OnMessageInput {
    sessionID: string
    message: MessageV2.User
    parts: MessageV2.Part[]
  }

  export interface OnMessageOutput {
    /** Whether to continue processing */
    shouldProcess: boolean
    /** Modified parts (if needed) */
    parts?: MessageV2.Part[]
  }

  export interface BeforeProcessInput {
    sessionID: string
    userMessage: MessageV2.User
    agent: any // Agent.Info
    model: Provider.Model
  }

  export interface BeforeProcessOutput {
    /** Override system prompt */
    systemPrompt?: string[]
    /** Override tools */
    tools?: Record<string, boolean>
  }

  export interface AfterProcessInput {
    sessionID: string
    assistantMessage: MessageV2.Assistant
    userMessage: MessageV2.User
  }

  export interface AfterProcessOutput {
    /** Whether to continue the loop */
    shouldContinue: boolean
  }

  export interface OnForkInput {
    sourceSessionID: string
    targetSessionID: string
    forkPointMessageID?: string
  }

  export interface OnForkOutput {
    /** Additional metadata for forked session */
    metadata?: Record<string, any>
  }

  export interface OnMergeInput {
    sourceSessionID: string
    targetSessionID: string
    strategy: "squash" | "rebase" | "selective"
  }

  export interface OnMergeOutput {
    /** Messages to add to target */
    messages: MessageV2.WithParts[]
  }

  export interface BuildContextInput {
    sessionID: string
    userMessage: MessageV2.User
    allMessages: MessageV2.WithParts[]
    model: Provider.Model
  }

  export interface BuildContextOutput {
    /** Messages to send to LLM */
    messages: any[] // ModelMessage[]
    /** Optional context metadata */
    metadata?: Record<string, any>
  }

  export interface ShouldCompactInput {
    sessionID: string
    lastAssistant: MessageV2.Assistant
    model: Provider.Model
  }

  export interface HandleCompactionInput {
    sessionID: string
    messages: MessageV2.WithParts[]
    model: Provider.Model
  }

  export interface HandleCompactionOutput {
    /** Whether to stop the loop */
    shouldStop: boolean
  }

  export interface GetMessagesInput {
    sessionID: string
    limit?: number
  }

  export interface GetContextMessagesInput {
    sessionID: string
    contextID?: string
    branchID?: string
  }
}
