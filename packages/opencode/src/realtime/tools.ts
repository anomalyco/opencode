/**
 * Realtime Tools
 *
 * Converts opencode tools to OpenAI Realtime API format and handles execution.
 */
import z from "zod"
import { Log } from "../util/log"

export namespace RealtimeTools {
  const log = Log.create({ service: "realtime.tools" })

  // ============================================================================
  // Types
  // ============================================================================

  /** Minimal tool interface for conversion (subset of Tool.Info) */
  export interface ToolInfo {
    id: string
    description: string
    parameters: z.ZodType
    execute: (
      args: unknown,
      ctx: ExecuteContext,
    ) => Promise<{
      title: string
      metadata: Record<string, unknown>
      output: string
    }>
  }

  export interface ExecuteContext {
    abort: AbortSignal
    sessionID?: string
    messageID?: string
  }

  /** OpenAI Realtime function tool format */
  export interface OpenAITool {
    type: "function"
    name: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  export interface FunctionCall {
    name: string
    call_id: string
    arguments: string
  }

  export interface FunctionResult {
    call_id: string
    output: string
  }

  // ============================================================================
  // Zod v4 to JSON Schema Conversion
  // ============================================================================

  interface JsonSchemaProperty {
    type?: string
    description?: string
    enum?: string[]
    items?: JsonSchemaProperty
    properties?: Record<string, JsonSchemaProperty>
    required?: string[]
  }

  /**
   * Convert a Zod v4 type to JSON Schema property
   */
  function zodToJsonSchemaProperty(zodType: z.ZodType): JsonSchemaProperty {
    const def = (zodType as any).def
    const typeStr = def?.type || (zodType as any).type

    // Get description if present
    const description = (zodType as any).description

    switch (typeStr) {
      case "string":
        return { type: "string", ...(description && { description }) }

      case "number":
        return { type: "number", ...(description && { description }) }

      case "boolean":
        return { type: "boolean", ...(description && { description }) }

      case "enum": {
        const options = (zodType as any).options || Object.values(def?.entries || {})
        return { type: "string", enum: options, ...(description && { description }) }
      }

      case "optional": {
        const innerType = def?.innerType
        if (innerType) {
          return zodToJsonSchemaProperty(innerType)
        }
        return { ...(description && { description }) }
      }

      case "nullable": {
        const innerType = def?.innerType
        if (innerType) {
          return zodToJsonSchemaProperty(innerType)
        }
        return { ...(description && { description }) }
      }

      case "array": {
        const elementType = def?.element || def?.innerType
        return {
          type: "array",
          ...(elementType && { items: zodToJsonSchemaProperty(elementType) }),
          ...(description && { description }),
        }
      }

      case "object": {
        const shape = def?.shape || {}
        const properties: Record<string, JsonSchemaProperty> = {}
        const required: string[] = []

        for (const [key, value] of Object.entries(shape)) {
          properties[key] = zodToJsonSchemaProperty(value as z.ZodType)
          // Check if field is required (not optional)
          const fieldDef = (value as any).def
          if (fieldDef?.type !== "optional" && fieldDef?.type !== "nullable") {
            required.push(key)
          }
        }

        return {
          type: "object",
          properties,
          ...(required.length > 0 && { required }),
          ...(description && { description }),
        }
      }

      default:
        // Fallback for unknown types
        return { ...(description && { description }) }
    }
  }

  /**
   * Convert a single tool to OpenAI Realtime function format
   */
  export function toolToOpenAIFormat(tool: ToolInfo): OpenAITool {
    const schema = zodToJsonSchemaProperty(tool.parameters)

    return {
      type: "function",
      name: tool.id,
      description: tool.description,
      parameters: {
        type: "object",
        properties: schema.properties ?? {},
        required: schema.required,
      },
    }
  }

  /**
   * Convert multiple tools to OpenAI format
   */
  export function toolsToOpenAIFormat(tools: ToolInfo[]): OpenAITool[] {
    return tools.map(toolToOpenAIFormat)
  }

  // ============================================================================
  // Tool Executor
  // ============================================================================

  export interface ToolExecutor {
    /** Execute a tool call */
    execute(call: FunctionCall, ctx?: Partial<ExecuteContext>): Promise<FunctionResult>
    /** Cancel a specific call */
    cancel(call_id: string): void
    /** Cancel all pending calls */
    cancelAll(): void
  }

  /**
   * Create a tool executor for handling function calls
   */
  export function createToolExecutor(tools: ToolInfo[]): ToolExecutor {
    const toolMap = new Map<string, ToolInfo>()
    for (const tool of tools) {
      toolMap.set(tool.id, tool)
    }

    // Track pending executions for cancellation
    const pendingCalls = new Map<string, AbortController>()

    return {
      async execute(call: FunctionCall, ctx?: Partial<ExecuteContext>): Promise<FunctionResult> {
        const tool = toolMap.get(call.name)
        if (!tool) {
          log.warn("unknown tool called", { name: call.name, call_id: call.call_id })
          return {
            call_id: call.call_id,
            output: JSON.stringify({
              error: `Unknown tool: ${call.name}`,
            }),
          }
        }

        // Parse arguments
        let args: unknown
        try {
          args = JSON.parse(call.arguments)
        } catch (err) {
          log.warn("invalid JSON arguments", { call_id: call.call_id, error: err })
          return {
            call_id: call.call_id,
            output: JSON.stringify({
              error: "Invalid JSON in arguments",
              details: err instanceof Error ? err.message : String(err),
            }),
          }
        }

        // Validate arguments with Zod
        const parseResult = tool.parameters.safeParse(args)
        if (!parseResult.success) {
          // Zod v4 uses .issues instead of .errors
          const issues = parseResult.error?.issues || []
          log.warn("argument validation failed", {
            call_id: call.call_id,
            issues,
          })
          return {
            call_id: call.call_id,
            output: JSON.stringify({
              error: "Argument validation failed",
              details: issues.map((e) => ({
                path: String((e.path as (string | number)[])?.join?.(".") ?? ""),
                message: String(e.message ?? ""),
              })),
            }),
          }
        }

        // Create abort controller for this call
        const abortController = new AbortController()
        pendingCalls.set(call.call_id, abortController)

        // Link to external abort signal if provided
        if (ctx?.abort) {
          ctx.abort.addEventListener("abort", () => abortController.abort())
        }

        // Execute tool
        log.info("executing tool", { name: call.name, call_id: call.call_id })
        try {
          const result = await tool.execute(parseResult.data, {
            abort: abortController.signal,
            sessionID: ctx?.sessionID,
            messageID: ctx?.messageID,
          })

          pendingCalls.delete(call.call_id)

          log.info("tool completed", { name: call.name, call_id: call.call_id })
          return {
            call_id: call.call_id,
            output: result.output,
          }
        } catch (err) {
          pendingCalls.delete(call.call_id)

          // Check if this was an abort
          if (abortController.signal.aborted) {
            log.info("tool interrupted", { name: call.name, call_id: call.call_id })
            return {
              call_id: call.call_id,
              output: JSON.stringify({
                interrupted: true,
                error: "Tool execution was interrupted",
              }),
            }
          }

          log.error("tool execution failed", {
            name: call.name,
            call_id: call.call_id,
            error: err,
          })
          return {
            call_id: call.call_id,
            output: JSON.stringify({
              error: "Tool execution failed",
              details: err instanceof Error ? err.message : String(err),
            }),
          }
        }
      },

      cancel(call_id: string) {
        const controller = pendingCalls.get(call_id)
        if (controller) {
          log.info("cancelling tool call", { call_id })
          controller.abort()
        }
      },

      cancelAll() {
        log.info("cancelling all tool calls", { count: pendingCalls.size })
        for (const [call_id, controller] of pendingCalls) {
          controller.abort()
        }
        pendingCalls.clear()
      },
    }
  }
}
