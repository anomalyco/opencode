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
    duration?: number
    request: {
      model: string
      messages: Array<{
        role: string
        content: string | any[]
        tool_calls?: any[]
        tool_call_id?: string
        reasoning_content?: string
      }>
      temperature?: number
      top_p?: number
      stream?: boolean
      stream_options?: {
        include_usage?: boolean
      }
      tools?: any[]
      max_tokens?: number
    }
    response?: {
      id?: string
      object?: string
      created?: number
      model?: string
      choices?: Array<{
        index: number
        message: {
          role: string
          content: string | null
          tool_calls?: any[]
          reasoning_content?: string
          refusal?: string | null
        }
        finish_reason: string
        logprobs?: any
      }>
      usage?: {
        prompt_tokens: number
        total_tokens: number
        completion_tokens: number
        cache_read_tokens?: number
        cache_write_tokens?: number
      }
      error?: Error
      content?: {
        text?: string[]
      }
    }
    error?: {
      name: string
      message: string
      stack?: string
    }
    system?: {
      hostname?: string
      platform?: string
      release?: string
      nodeVersion?: string
    }
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

      // Create a filename with timestamp, session ID, and request ID
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
    tools: any[] | Record<string, any>
    parameters: {
      temperature?: number
      topP?: number
      topK?: number
      maxOutputTokens?: number
      stream?: boolean
      options?: any
    }
  }): TraceEntry {
    // Merge system prompts into messages array as role "system"
    const systemMessages = input.system.map((content) => ({
      role: "system",
      content,
    }))

    // Format tools - convert Record to array if needed
    let formattedTools: any[] | undefined = undefined
    if (input.tools) {
      if (Array.isArray(input.tools)) {
        formattedTools = input.tools.length > 0 ? input.tools : undefined
      } else {
        const toolsArray = Object.values(input.tools)
        formattedTools = toolsArray.length > 0 ? toolsArray : undefined
      }
    }

    return {
      timestamp: new Date().toISOString(),
      sessionID: input.sessionID,
      requestID: generateRequestID(),
      providerID: input.providerID,
      modelID: input.modelID,
      agent: input.agent,
      request: {
        model: input.modelID,
        messages: [...systemMessages, ...input.messages],
        temperature: input.parameters.temperature,
        top_p: input.parameters.topP,
        stream: input.parameters.stream ?? true,
        stream_options: {
          include_usage: true,
        },
        tools: formattedTools,
        max_tokens: input.parameters.maxOutputTokens,
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
      id?: string
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
      duration?: number
    },
  ): void {
    // Store duration if provided
    if (response.duration !== undefined) {
      entry.duration = response.duration
    }

    if (response.error) {
      entry.error = {
        name: response.error.name,
        message: response.error.message,
        stack: response.error.stack,
      }
      // Add system information even on error
      entry.system = {
        hostname: process.env.HOSTNAME,
        platform: process.platform,
        release: process.release?.name,
        nodeVersion: process.version,
      }
      return
    }

    // Build message content
    let messageContent: string | null = null
    const toolCalls: any[] = []

    if (response.content?.text && response.content.text.length > 0) {
      messageContent = response.content.text.join("")
    }

    if (response.content?.toolCalls && response.content.toolCalls.length > 0) {
      response.content.toolCalls.forEach((tc) => {
        toolCalls.push({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        })
      })
    }

    entry.response = {
      id: response.id || `chatcmpl-${Date.now().toString(36)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: entry.request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: messageContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            reasoning_content: response.content?.reasoning?.join("") || undefined,
            refusal: null,
          },
          finish_reason: response.finishReason || "stop",
          logprobs: null,
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.inputTokens || response.usage.promptTokens || 0,
            total_tokens: response.usage.totalTokens || 0,
            completion_tokens: response.usage.outputTokens || response.usage.completionTokens || 0,
            cache_read_tokens: response.usage.cachedInputTokens || response.usage.cacheReadTokens,
            cache_write_tokens: response.usage.cacheCreationTokens,
          }
        : undefined,
    }

    // Add system information
    entry.system = {
      hostname: process.env.HOSTNAME,
      platform: process.platform,
      release: process.release?.name,
      nodeVersion: process.version,
    }
  }
}
