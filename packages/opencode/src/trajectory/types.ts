/**
 * Trajectory event type definitions
 * These define the schema for events recorded to JSONL files
 */

export namespace Trajectory {
  export interface SessionStartEvent {
    type: "session_start"
    timestamp: number
    sessionID: string
    agent: string
    model: {
      provider: string
      id: string
    }
    workingDirectory: string
  }

  export interface LLMInteractionEvent {
    type: "llm_interaction"
    timestamp: number
    sessionID: string
    messageID: string
    step: number
    interactionType: "stream" | "generate"
    purpose: "agent_step" | "title" | "summary" | "compaction"
    input: {
      systemPrompts: string[]
      messages: unknown[]
      toolCount: number
      toolNames: string[]
      parameters: {
        temperature?: number
        topP?: number
        maxOutputTokens?: number
      }
    }
    response: {
      finishReason: string
      usage: {
        inputTokens: number
        outputTokens: number
        reasoningTokens?: number
        cacheReadTokens?: number
        cacheWriteTokens?: number
        totalInputTokens?: number
        totalOutputTokens?: number
        totalCacheTokens?: number
      }
      textLength: number
      reasoningLength: number
      hasHiddenReasoning: boolean
      toolCallCount: number
    }
    startTime: number
    endTime: number
    duration: number
  }

  export interface StreamEvent {
    type: "stream_event"
    timestamp: number
    sessionID: string
    messageID: string
    step: number
    eventType:
      | "start"
      | "step-start"
      | "reasoning"
      | "response"
      | "tool-call"
      | "tool-result"
      | "step-finish"
      | "finish"
    data: {
      phase?: "turn" | "step"
      text?: string
      reasoning?: string
      toolName?: string
      toolCallId?: string
      input?: Record<string, unknown>
      output?: string
      finishReason?: string
      usage?: unknown
    }
  }

  export interface ToolExecutionEvent {
    type: "tool_execution"
    timestamp: number
    sessionID: string
    messageID: string
    step: number
    tool: string
    callID: string
    input: Record<string, unknown>
    status: "pending" | "running" | "completed" | "error"
    startTime: number
    endTime?: number
    duration?: number
    result?: {
      title: string
      output: string
      metadata?: unknown
      attachments?: Array<{ type: string; path: string }>
    }
    error?: {
      message: string
      code?: string
    }
  }

  export interface AgentStepEvent {
    type: "agent_step"
    timestamp: number
    sessionID: string
    step: number
    action: "loop_start" | "llm_call" | "tool_execution" | "compaction" | "subtask" | "exit_check" | "loop_end"
    state: {
      messageCount: number
      hasSnapshot: boolean
      contextOverflow: boolean
    }
    decision?: {
      type: "continue" | "exit" | "compact" | "subtask"
      reason?: string
    }
  }

  export interface CompactionEvent {
    type: "compaction"
    timestamp: number
    sessionID: string
    action: "start" | "prune" | "summarize" | "end"
    trigger?: {
      reason: "context_overflow" | "manual"
      messageCount: number
      tokenCount: number
      contextLimit: number
    }
    pruneDetails?: {
      toolsPruned: number
      tokensSaved: number
      oldestCompactedMessageID: string
    }
    summaryDetails?: {
      summaryMessageID: string
      originalMessageCount: number
      summarizedMessageCount: number
    }
    result?: {
      success: boolean
      newMessageCount: number
      tokenReduction: number
    }
  }

  export type Event =
    | SessionStartEvent
    | LLMInteractionEvent
    | StreamEvent
    | ToolExecutionEvent
    | AgentStepEvent
    | CompactionEvent
}
