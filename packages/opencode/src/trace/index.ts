import z from "zod/v4"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { ToolHistory } from "../tool/history"
import type { TelemetryEvent } from "../tool/telemetry-event"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { Instance } from "../project/instance"

export namespace Trace {
  export const TokenUsage = z.object({
    input: z.number().default(0),
    output: z.number().default(0),
    reasoning: z.number().default(0),
    cache: z
      .object({
        read: z.number().default(0),
        write: z.number().default(0),
      })
      .default({ read: 0, write: 0 }),
  })
  export type TokenUsage = z.infer<typeof TokenUsage>

  export const ModelConfig = z.object({
    provider: z.string(),
    model: z.string(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
  })
  export type ModelConfig = z.infer<typeof ModelConfig>

  export const Summary = z.object({
    duration: z.number(),
    toolCallCount: z.number(),
    errorCount: z.number(),
    tokens: TokenUsage,
    cost: z.number(),
  })
  export type Summary = z.infer<typeof Summary>

  export const Complete = z.object({
    id: z.string(),
    projectID: z.string(),
    
    // Session data
    session: Session.Info,
    messageCount: z.number(),
    
    // Execution context
    agentName: z.string(),
    modelConfig: ModelConfig,
    systemPrompt: z.string().optional(),
    systemPromptVersion: z.string().optional(),
    
    // Tool events
    toolCalls: z.array(z.any()), // TelemetryEvent array
    
    // Aggregated metrics
    summary: Summary,
    
    // Evaluation results (populated later)
    evaluationIDs: z.array(z.string()).default([]),
    
    // Metadata
    createdAt: z.number(),
    completedAt: z.number().optional(),
  })
  export type Complete = z.infer<typeof Complete>

  export const Filter = z.object({
    projectID: z.string().optional(),
    agentName: z.string().optional(),
    minDuration: z.number().optional(),
    maxDuration: z.number().optional(),
    hasErrors: z.boolean().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
  })
  export type Filter = z.infer<typeof Filter>

  export const Event = {
    Completed: Bus.event(
      "trace.completed",
      z.object({
        trace: Complete,
      }),
    ),
  }

  /**
   * Materialize a session into a complete trace
   */
  export async function materialize(sessionID: string): Promise<Complete> {
    const session = await Session.get(sessionID)
    const messages = await Session.messages(sessionID)
    
    // Get telemetry events for this session
    const history = await ToolHistory.read()
    const toolCalls = history.events.filter((e) => e.sessionID === sessionID)
    
    // Extract model config from first assistant message
    const firstAssistant = messages.find((m) => m.info.role === "assistant")
    let modelConfig: ModelConfig
    if (firstAssistant && firstAssistant.info.role === "assistant") {
      const info = firstAssistant.info as MessageV2.Assistant
      modelConfig = {
        provider: info.providerID ?? "unknown",
        model: info.modelID ?? "unknown",
        temperature: undefined, // TODO: extract from metadata if available
        maxTokens: undefined,
      }
    } else {
      modelConfig = {
        provider: "unknown",
        model: "unknown",
      }
    }
    
    // Compute summary
    const summary = computeSummary(messages, toolCalls)
    
    // Get agent name from session or default
    const agentName = "default" // TODO: extract from session metadata
    
    const trace: Complete = {
      id: session.id,
      projectID: session.projectID,
      session,
      messageCount: messages.length,
      agentName,
      modelConfig,
      systemPrompt: undefined, // TODO: load from session init
      systemPromptVersion: undefined,
      toolCalls,
      summary,
      evaluationIDs: [],
      createdAt: session.time.created,
      completedAt: session.time.updated,
    }
    
    // Store the trace
    await Storage.write(["trace", session.projectID, session.id], trace)
    
    // Emit event
    Bus.publish(Event.Completed, { trace })
    
    return trace
  }

  /**
   * Get a specific trace
   */
  export async function get(traceID: string): Promise<Complete> {
    const projectID = Instance.project.id
    const trace = await Storage.read<Complete>(["trace", projectID, traceID])
    return trace
  }

  /**
   * List traces with optional filtering
   */
  export async function* list(filter?: Filter): AsyncIterableIterator<Complete> {
    const projectID = filter?.projectID ?? Instance.project.id
    const prefix = ["trace", projectID]
    
    const keys = await Storage.list(prefix)
    
    for (const key of keys) {
      const trace = await Storage.read<Complete>(key)
      
      // Apply filters
      if (filter) {
        if (filter.agentName && trace.agentName !== filter.agentName) continue
        if (filter.minDuration && trace.summary.duration < filter.minDuration) continue
        if (filter.maxDuration && trace.summary.duration > filter.maxDuration) continue
        if (filter.hasErrors !== undefined) {
          const hasErrors = trace.summary.errorCount > 0
          if (filter.hasErrors !== hasErrors) continue
        }
        if (filter.since && trace.createdAt < filter.since) continue
        if (filter.until && trace.createdAt > filter.until) continue
      }
      
      yield trace
    }
  }

  /**
   * Check if a trace exists
   */
  export async function exists(traceID: string): Promise<boolean> {
    try {
      await get(traceID)
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete a trace
   */
  export async function remove(traceID: string): Promise<void> {
    const projectID = Instance.project.id
    await Storage.remove(["trace", projectID, traceID])
  }

  /**
   * Compute summary statistics from messages and tool calls
   */
  function computeSummary(messages: any[], toolCalls: TelemetryEvent[]): Summary {
    let totalCost = 0
    let tokens: TokenUsage = {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    }
    
    // Aggregate from messages
    for (const message of messages) {
      if (message.info.role === "assistant") {
        const info = message.info as MessageV2.Assistant
        totalCost += info.cost ?? 0
        if (info.tokens) {
          tokens.input += info.tokens.input ?? 0
          tokens.output += info.tokens.output ?? 0
          tokens.reasoning += info.tokens.reasoning ?? 0
          if (info.tokens.cache) {
            tokens.cache.read += info.tokens.cache.read ?? 0
            tokens.cache.write += info.tokens.cache.write ?? 0
          }
        }
      }
    }
    
    // Compute duration and error count from tool calls
    const errorCount = toolCalls.filter((t) => t.status === "error").length
    const durations = toolCalls.map((t) => t.duration)
    const totalDuration = durations.length > 0 ? Math.max(...durations) : 0
    
    return {
      duration: totalDuration,
      toolCallCount: toolCalls.length,
      errorCount,
      tokens,
      cost: totalCost,
    }
  }
}
