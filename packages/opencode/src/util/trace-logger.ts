import { Flag } from "@/flag/flag"
import { Log } from "./log"
import path from "path"
import fs from "fs/promises"

export namespace TraceLogger {
  const log = Log.create({ service: "trace-logger" })

  let traceDir: string | undefined = undefined
  let enabled = false

  /**
   * Initialize the trace logger with the specified directory.
   * Can be called from CLI options or will use environment variable.
   */
  export function init(directory?: string) {
    traceDir = directory || Flag.OPENCODE_TRACE_DIR
    enabled = !!traceDir

    if (enabled) {
      log.info("trace logging enabled", { directory: traceDir })
    }
  }

  /**
   * Check if trace logging is enabled
   */
  export function isEnabled(): boolean {
    return enabled
  }

  /**
   * Get the trace directory path
   */
  export function getDirectory(): string | undefined {
    return traceDir
  }

  export type TraceEntry = {
    timestamp: string
    sessionID: string
    requestID: string
    providerID: string
    modelID: string
    agent: string
    request: {
      messages: any[]
      tools: Record<string, any>
      parameters: {
        temperature?: number
        topP?: number
        topK?: number
        maxOutputTokens?: number
        options?: any
      }
    }
    response?: {
      finishReason?: string
      usage?: {
        inputTokens: number
        outputTokens: number
        totalTokens: number
        cacheReadTokens?: number
        cacheWriteTokens?: number
      }
      content?: {
        text?: string[]
        toolCalls?: Array<{
          id: string
          name: string
          input: any
        }>
        reasoning?: string[]
      }
      error?: {
        name: string
        message: string
        stack?: string
      }
    }
    duration?: number
  }

  /**
   * Log a trace entry for an LLM request-response pair
   */
  export async function logTrace(entry: TraceEntry): Promise<void> {
    if (!enabled || !traceDir) {
      return
    }

    try {
      // Ensure the trace directory exists
      await fs.mkdir(traceDir, { recursive: true })

      // Create a filename with timestamp and request ID
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const filename = `${timestamp}_${entry.sessionID}_${entry.requestID}.json`
      const filepath = path.join(traceDir, filename)

      // Write the trace entry as formatted JSON
      await fs.writeFile(filepath, JSON.stringify(entry, null, 2), "utf-8")

      log.debug("trace logged", { filepath })
    } catch (error) {
      log.error("failed to write trace", { error })
    }
  }

  /**
   * Create a trace entry from LLM stream input
   */
  export function createTraceEntry(input: {
    sessionID: string
    providerID: string
    modelID: string
    agent: string
    system: string[]
    messages: any[]
    tools: Record<string, any>
    parameters: {
      temperature?: number
      topP?: number
      topK?: number
      maxOutputTokens?: number
      options?: any
    }
  }): TraceEntry {
    // Merge system prompts into messages array as role "system"
    const systemMessages = input.system.map((content) => ({
      role: "system" as const,
      content,
    }))

    return {
      timestamp: new Date().toISOString(),
      sessionID: input.sessionID,
      requestID: generateRequestID(),
      providerID: input.providerID,
      modelID: input.modelID,
      agent: input.agent,
      request: {
        messages: [...systemMessages, ...input.messages],
        tools: input.tools,
        parameters: input.parameters,
      },
    }
  }

  /**
   * Generate a unique request ID for tracing
   */
  function generateRequestID(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 10)
    return `trace_${timestamp}_${random}`
  }

  /**
   * Update a trace entry with response data
   */
  export function updateTraceWithResponse(
    entry: TraceEntry,
    response: {
      finishReason?: string
      usage?: any
      content?: {
        text?: string[]
        toolCalls?: Array<{
          id: string
          name: string
          input: any
        }>
        reasoning?: string[]
      }
      error?: Error
      duration: number
    },
  ): void {
    entry.duration = response.duration
    entry.response = {
      finishReason: response.finishReason,
      usage: response.usage
        ? {
            inputTokens: response.usage.promptTokens || 0,
            outputTokens: response.usage.completionTokens || 0,
            totalTokens: response.usage.totalTokens || 0,
            cacheReadTokens: response.usage.cacheReadTokens,
            cacheWriteTokens: response.usage.cacheCreationTokens,
          }
        : undefined,
      content: response.content,
      error: response.error
        ? {
            name: response.error.name,
            message: response.error.message,
            stack: response.error.stack,
          }
        : undefined,
    }
  }
}
