import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Content,
} from "@ai-sdk/provider"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { ACPClient } from "./client"
import { vercelToACPMessages } from "./converters"
import type { ACPModelConfig } from "./types"
import { Log } from "../../util/log"
import { Config } from "../../config/config"
import { Agent } from "../../agent/agent"

const log = Log.create({ service: "acp-model" })

/**
 * ACPLanguageModel implements LanguageModelV2 for ACP agents
 */
export class ACPLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly modelId: string
  readonly defaultObjectGenerationMode = "json"
  readonly supportedUrls = {}

  private command: string
  private args: string[]
  private maxTokens?: number

  constructor(config: ACPModelConfig) {
    this.modelId = config.modelId
    this.command = config.command
    this.args = config.args
    this.maxTokens = config.maxTokens
  }

  get provider(): string {
    return "acp"
  }

  private getSessionContext(options: LanguageModelV2CallOptions) {
    // ProviderTransform.providerOptions wraps options under the provider ID key
    // The provider ID is user-defined in the config (e.g., "cursor-acp", "my-agent"),
    // so we check all nested objects to find our session context fields
    const providerOptions = options.providerOptions as Record<string, any> | undefined
    if (!providerOptions) return undefined

    // Find any nested object that contains session context fields
    for (const key of Object.keys(providerOptions)) {
      const opts = providerOptions[key] as Record<string, any> | undefined
      if (opts?.sessionID && opts?.messageID && opts?.agentName) {
        return {
          sessionID: opts.sessionID as string,
          messageID: opts.messageID as string,
          agentName: opts.agentName as string,
        }
      }
    }

    return undefined
  }

  /**
   * Generate a non-streaming response
   */
  async doGenerate(options: LanguageModelV2CallOptions): Promise<{
    content: LanguageModelV2Content[]
    finishReason: LanguageModelV2FinishReason
    usage: {
      inputTokens: number | undefined
      outputTokens: number | undefined
      totalTokens: number | undefined
    }
    warnings: Array<LanguageModelV2CallWarning>
  }> {
    using _ = log.time("doGenerate", { modelId: this.modelId })

    const config = await Config.get()
    const agentName = typeof config.agent === "string" ? config.agent : "build"
    const agent = await Agent.get(agentName)
    const sessionContext = this.getSessionContext(options)

    const clientArgs = [...this.args, "--model", this.modelId]
    const client = new ACPClient(this.command, clientArgs, agent.permission, sessionContext)

    try {
      await client.initialize()

      const sessionId = await client.createSession({
        model: undefined,
        ...(this.maxTokens && { maxTokens: this.maxTokens }),
      })

      // Convert messages to ACP format
      const acpMessages = vercelToACPMessages(options.prompt)

      // Collect response parts
      let accumulatedText = ""
      const toolCalls: LanguageModelV2Content[] = []
      let finishReason: LanguageModelV2FinishReason = "unknown"
      let inputTokens: number | undefined
      let outputTokens: number | undefined

      // Set up update handler to collect content
      client.onUpdate((notification: SessionNotification) => {
        try {
          const update = notification.update

          switch (update.sessionUpdate) {
            case "agent_message_chunk":
            case "agent_thought_chunk":
              // Accumulate text chunks
              if (update.content && update.content.type === "text") {
                accumulatedText += update.content.text
              }
              break

            case "tool_call":
              // Collect tool calls
              toolCalls.push({
                type: "tool-call",
                toolCallId: update.toolCallId,
                toolName: update.title || "unknown",
                input: JSON.stringify(update.rawInput || {}),
              })
              break
          }
        } catch (error) {
          log.error("Error handling session update", { error })
          // Don't throw - let the main flow handle completion
        }
      })

      // Send the prompt
      const result = await client.sendMessage(sessionId, acpMessages)

      // Map finish reason from result
      finishReason = mapACPFinishReason(result.stopReason)

      // Close session and cleanup
      await client.closeSession(sessionId)

      // Build final content array
      const content: LanguageModelV2Content[] = []
      if (accumulatedText) {
        content.push({ type: "text", text: accumulatedText })
      }
      content.push(...toolCalls)

      return {
        content,
        finishReason,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: undefined,
        },
        warnings: [],
      }
    } finally {
      await client.cleanup()
    }
  }

  /**
   * Generate a streaming response
   */
  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>
    request?: { body?: unknown }
    response?: { headers?: Record<string, string> }
  }> {
    using _ = log.time("doStream", { modelId: this.modelId })

    const config = await Config.get()
    const agentName = typeof config.agent === "string" ? config.agent : "build"
    const agent = await Agent.get(agentName)
    const sessionContext = this.getSessionContext(options)

    const clientArgs = [...this.args, "--model", this.modelId]
    const client = new ACPClient(this.command, clientArgs, agent.permission, sessionContext)

    const maxTokens = this.maxTokens

    // Create a ReadableStream that will yield the chunks
    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        try {
          await client.initialize()

          const sessionId = await client.createSession({
            model: undefined,
            ...(maxTokens && { maxTokens }),
          })

          // Convert messages to ACP format
          const acpMessages = vercelToACPMessages(options.prompt)

          // Track whether we've started the text and reasoning parts
          let textPartStarted = false
          let reasoningPartStarted = false
          const textPartId = sessionId // Use sessionId as the text part ID
          const reasoningPartId = `${sessionId}-reasoning`
          const toolCallsTracked = new Map<string, { toolName: string; input: Record<string, unknown> }>()
          let lastPendingToolCallId: string | null = null

          // Track pending notification processing
          let pendingNotifications = 0

          // Helper to complete last pending tool
          const completePendingTool = () => {
            if (lastPendingToolCallId) {
              const tracked = toolCallsTracked.get(lastPendingToolCallId)
              if (tracked) {
                log.info("ACP: completing pending tool on next chunk", {
                  toolCallId: lastPendingToolCallId,
                  toolName: tracked.toolName,
                })
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: lastPendingToolCallId,
                  toolName: tracked.toolName,
                  result: {
                    output: "Tool completed by provider",
                    title: tracked.toolName,
                    metadata: {},
                  },
                  providerExecuted: true,
                } as any)
                toolCallsTracked.delete(lastPendingToolCallId)
              }
              lastPendingToolCallId = null
            }
          }

          // Set up update handler to push to stream
          client.onUpdate((notification: SessionNotification) => {
            pendingNotifications++
            try {
              const update = notification.update

              switch (update.sessionUpdate) {
                case "agent_thought_chunk":
                  // Complete any pending tool before new content
                  completePendingTool()

                  // Handle thinking/reasoning content
                  if (update.content && update.content.type === "text") {
                    // Emit reasoning-start before first delta
                    if (!reasoningPartStarted) {
                      controller.enqueue({
                        type: "reasoning-start",
                        id: reasoningPartId,
                      })
                      reasoningPartStarted = true
                    }

                    controller.enqueue({
                      type: "reasoning-delta",
                      id: reasoningPartId,
                      delta: update.content.text,
                    })
                  }
                  break

                case "agent_message_chunk":
                  // Complete any pending tool before new content
                  completePendingTool()

                  // Handle text content
                  if (update.content && update.content.type === "text") {
                    // Emit text-start before first delta
                    if (!textPartStarted) {
                      controller.enqueue({
                        type: "text-start",
                        id: textPartId,
                      })
                      textPartStarted = true
                    }

                    controller.enqueue({
                      type: "text-delta",
                      id: textPartId,
                      delta: update.content.text,
                    })
                  }
                  break

                case "tool_call": {
                  // Complete any previous pending tool before starting a new one
                  completePendingTool()

                  const toolCallId = update.toolCallId
                  const kind = (update as any).kind as string | undefined
                  const mappedFromKind = mapACPToolKindToOpenCodeTool(kind)
                  const toolName = mappedFromKind || update.title || "acp_tool"
                  const rawInput = (update.rawInput || {}) as Record<string, unknown>
                  const input = normalizeToolInput(toolName, rawInput)

                  log.info("ACP: tool_call", {
                    toolCallId,
                    kind,
                    mappedFromKind,
                    updateTitle: update.title,
                    finalToolName: toolName,
                    status: update.status,
                    rawInput: update.rawInput,
                    normalized: input,
                    allFields: Object.keys(update),
                  })
                  toolCallsTracked.set(toolCallId, { toolName, input })

                  // Emit tool-input-start with providerExecuted flag
                  const toolInputStart = {
                    type: "tool-input-start" as const,
                    id: toolCallId,
                    toolName,
                    providerExecuted: true,
                  }
                  log.info("ACP: enqueuing tool-input-start", toolInputStart)
                  controller.enqueue(toolInputStart)

                  // Emit tool-input-start and tool-call for all statuses
                  const toolCall = {
                    type: "tool-call" as const,
                    toolCallId,
                    toolName,
                    input: JSON.stringify(input),
                    providerExecuted: true,
                  }
                  log.info("ACP: enqueuing tool-call", { ...toolCall, input: JSON.stringify(input).substring(0, 100) })
                  controller.enqueue(toolCall)

                  // Only emit tool-result for completed/failed states
                  // For pending state, wait for next chunk to complete it
                  if (update.status === "completed") {
                    const outputValue = update.rawOutput ?? "Tool completed"
                    // Cursor-agent sends rawOutput as an object like { content: "..." }
                    // Need to extract the actual content
                    const output =
                      typeof outputValue === "object" && outputValue !== null && "content" in outputValue
                        ? String(outputValue.content)
                        : typeof outputValue === "string"
                          ? outputValue
                          : JSON.stringify(outputValue)
                    log.info(`ACP: enqueuing tool-result (completed)`, {
                      toolCallId,
                      toolName,
                      output: output.substring(0, 100),
                    })
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId,
                      toolName,
                      result: {
                        output,
                        title: update.title ?? toolName,
                        metadata: {},
                      },
                      providerExecuted: true,
                    } as any)
                    toolCallsTracked.delete(toolCallId)
                  } else if (update.status === "failed") {
                    const errorValue = update.rawOutput ?? update.title ?? "Tool failed"
                    const output =
                      typeof errorValue === "object" && errorValue !== null && "content" in errorValue
                        ? String(errorValue.content)
                        : typeof errorValue === "string"
                          ? errorValue
                          : JSON.stringify(errorValue)
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId,
                      toolName,
                      result: {
                        output,
                        title: update.title ?? toolName,
                        metadata: {},
                      },
                      isError: true,
                      providerExecuted: true,
                    } as any)
                    toolCallsTracked.delete(toolCallId)
                  } else if (update.status === "pending") {
                    // Mark as last pending tool - will complete on next chunk
                    lastPendingToolCallId = toolCallId
                  }
                  break
                }

                case "tool_call_update": {
                  const toolCallId = update.toolCallId
                  const tracked = toolCallsTracked.get(toolCallId)
                  if (!tracked) break

                  const { toolName, input } = tracked

                  // Clear pending if this is the tool being updated
                  if (lastPendingToolCallId === toolCallId) {
                    lastPendingToolCallId = null
                  }

                  if (update.status === "in_progress" && !toolCallsTracked.get(toolCallId + "_called")) {
                    toolCallsTracked.set(toolCallId + "_called", { toolName, input })
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId,
                      toolName,
                      input: JSON.stringify(input),
                      providerExecuted: true,
                    })
                  }

                  if (update.status === "completed") {
                    const outputValue = update.rawOutput ?? "Tool completed"
                    const output =
                      typeof outputValue === "object" && outputValue !== null && "content" in outputValue
                        ? String(outputValue.content)
                        : typeof outputValue === "string"
                          ? outputValue
                          : JSON.stringify(outputValue)
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId,
                      toolName,
                      result: {
                        output,
                        title: update.title ?? toolName,
                        metadata: {},
                      },
                      providerExecuted: true,
                    } as any)
                    toolCallsTracked.delete(toolCallId)
                    toolCallsTracked.delete(toolCallId + "_called")
                  } else if (update.status === "failed") {
                    const errorValue = update.rawOutput ?? update.title ?? "Tool failed"
                    const output =
                      typeof errorValue === "object" && errorValue !== null && "content" in errorValue
                        ? String(errorValue.content)
                        : typeof errorValue === "string"
                          ? errorValue
                          : JSON.stringify(errorValue)
                    controller.enqueue({
                      type: "tool-result",
                      toolCallId,
                      toolName,
                      result: {
                        output,
                        title: update.title ?? toolName,
                        metadata: {},
                      },
                      isError: true,
                      providerExecuted: true,
                    } as any)
                    toolCallsTracked.delete(toolCallId)
                    toolCallsTracked.delete(toolCallId + "_called")
                  }
                  break
                }
              }
            } catch (error) {
              log.error("Error handling session update", { error })
              controller.error(error)
            } finally {
              pendingNotifications--
            }
          })

          // Send the prompt and wait for completion
          const result = await client.sendMessage(sessionId, acpMessages)

          // Wait for all pending notifications to be processed
          const maxWaitMs = 5000
          const checkIntervalMs = 10
          const startTime = Date.now()

          await new Promise<void>((resolve) => {
            const check = () => {
              if (pendingNotifications === 0 || Date.now() - startTime > maxWaitMs) {
                resolve()
              } else {
                setTimeout(check, checkIntervalMs)
              }
            }
            check()
          })

          // Complete any final pending tool
          completePendingTool()

          // After completion, emit finish event
          if (reasoningPartStarted) {
            controller.enqueue({
              type: "reasoning-end",
              id: reasoningPartId,
            })
          }

          if (textPartStarted) {
            controller.enqueue({
              type: "text-end",
              id: textPartId,
            })
          }

          controller.enqueue({
            type: "finish",
            finishReason: mapACPFinishReason(result.stopReason),
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
          })
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel() {
        await client.cleanup()
      },
    })

    return { stream }
  }
}

/**
 * Map ACP stop reason to Vercel AI SDK finish reason
 */
function mapACPFinishReason(stopReason: string | undefined): LanguageModelV2FinishReason {
  switch (stopReason) {
    case "end_turn":
    case "stop":
      return "stop"
    case "max_tokens":
      return "length"
    case "tool_use":
      return "tool-calls"
    case "error":
      return "error"
    default:
      return "unknown"
  }
}

/**
 * Normalize tool input field names from ACP to OpenCode conventions
 *
 * ACP uses different field names than OpenCode's tool UI expects:
 * - read tool: ACP sends "path", OpenCode UI expects "filePath"
 */
function normalizeToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  switch (toolName) {
    case "read":
      // Map "path" to "filePath" for read tool
      if (input.path && !input.filePath) {
        return { ...input, filePath: input.path }
      }
      return input

    default:
      return input
  }
}

/**
 * Map ACP ToolKind to OpenCode tool names
 */
function mapACPToolKindToOpenCodeTool(kind: string | undefined): string | null {
  switch (kind) {
    case "read":
      return "read"
    case "edit":
      return "edit"
    case "execute":
      return "bash"
    case "fetch":
      return "webfetch"
    default:
      return null
  }
}
