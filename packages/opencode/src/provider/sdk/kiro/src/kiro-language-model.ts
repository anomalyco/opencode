import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2FunctionTool,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { convertToKiroPayload, type KiroProviderOptions } from "./converters"
import { normalizeModelName } from "./model-resolver"
import { parseAwsEventStream, type KiroEvent } from "./streaming"
import { estimatePayloadTokens, countTokens } from "./tokenizer"

export interface KiroLanguageModelConfig {
  provider: string
  apiKey?: string
  baseURL: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

export class KiroLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly modelId: string
  private readonly config: KiroLanguageModelConfig

  readonly supportedUrls: Record<string, RegExp[]> = {
    "image/*": [/^https?:\/\/.*$/],
    "application/pdf": [/^https?:\/\/.*$/],
  }

  constructor(modelId: string, config: KiroLanguageModelConfig) {
    this.modelId = modelId
    this.config = config
  }

  get provider(): string {
    return this.config.provider
  }

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const result = await this.doStream(options)
    const reader = result.stream.getReader()

    const content: LanguageModelV2Content[] = []
    let finishReason: LanguageModelV2FinishReason = "unknown"
    const usage: LanguageModelV2Usage = {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    }
    const warnings: LanguageModelV2CallWarning[] = []

    let currentText = ""
    let currentTextId: string | null = null
    const toolCalls: Map<string, { toolName: string; input: string }> = new Map()
    let currentReasoning = ""
    let currentReasoningId: string | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      switch (value.type) {
        case "stream-start":
          warnings.push(...(value.warnings || []))
          break

        case "text-start":
          currentTextId = value.id
          currentText = ""
          break

        case "text-delta":
          currentText += value.delta
          break

        case "text-end":
          if (currentText) {
            content.push({
              type: "text",
              text: currentText,
            })
          }
          currentTextId = null
          break

        case "reasoning-start":
          currentReasoningId = value.id
          currentReasoning = ""
          break

        case "reasoning-delta":
          currentReasoning += value.delta
          break

        case "reasoning-end":
          if (currentReasoning) {
            content.push({
              type: "reasoning",
              text: currentReasoning,
            })
          }
          currentReasoningId = null
          break

        case "tool-input-start":
          toolCalls.set(value.id, { toolName: value.toolName, input: "" })
          break

        case "tool-input-delta":
          const toolCall = toolCalls.get(value.id)
          if (toolCall) {
            toolCall.input += value.delta
          }
          break

        case "tool-call":
          content.push({
            type: "tool-call",
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            input: value.input,
          })
          break

        case "finish":
          finishReason = value.finishReason
          if (value.usage) {
            usage.inputTokens = value.usage.inputTokens
            usage.outputTokens = value.usage.outputTokens
            usage.totalTokens = value.usage.totalTokens
          }
          break
      }
    }

    // Handle any remaining text
    if (currentTextId && currentText) {
      content.push({
        type: "text",
        text: currentText,
      })
    }

    // Handle any remaining reasoning
    if (currentReasoningId && currentReasoning) {
      content.push({
        type: "reasoning",
        text: currentReasoning,
      })
    }

    return {
      content,
      finishReason,
      usage,
      warnings,
      request: result.request,
      response: result.response,
    }
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const kiroModelId = normalizeModelName(this.modelId)
    const functionTools = options.tools?.filter((tool): tool is LanguageModelV2FunctionTool => tool.type === "function")

    // Extract Kiro-specific provider options for thinking mode
    const kiroProviderOptions: KiroProviderOptions | undefined = options.providerOptions?.kiro as
      | KiroProviderOptions
      | undefined

    const payload = convertToKiroPayload(options.prompt, kiroModelId, functionTools, kiroProviderOptions)

    // Pre-flight context overflow check — let the compaction system handle it
    const KIRO_CONTEXT_LIMIT = 210_000
    const KIRO_PAYLOAD_BYTE_LIMIT = 450_000
    const estimated = estimatePayloadTokens(payload)
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf-8")
    const historyLen = payload.conversationState.history?.length ?? 0
    if (estimated > KIRO_CONTEXT_LIMIT || payloadBytes > KIRO_PAYLOAD_BYTE_LIMIT) {
      const { APICallError } = await import("ai")
      throw new APICallError({
        message: `Input token count ${estimated} exceeds the maximum ${KIRO_CONTEXT_LIMIT} for this model`,
        url: `${this.config.baseURL}/generateAssistantResponse`,
        requestBodyValues: {},
        statusCode: 400,
        responseBody: `estimated ${estimated} tokens / ${payloadBytes} bytes exceeds context window`,
        isRetryable: false,
      })
    }

    // 意味のあるコンテンツがない場合は早期リターン（無限ループ防止）
    const currentMessage = payload.conversationState.currentMessage.userInputMessage
    const hasUserContent = currentMessage.content && currentMessage.content !== "."
    const hasToolResults = (currentMessage.userInputMessageContext?.toolResults?.length ?? 0) > 0

    if (!hasUserContent && !hasToolResults) {
      // 空のストリームを返して終了
      return {
        stream: new ReadableStream<LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            })
            controller.close()
          },
        }),
        request: { body: payload },
        response: { headers: {} },
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/vnd.amazon.eventstream",
      ...this.config.headers,
    }

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`
    }

    // Merge with request headers
    const requestHeaders: Record<string, string> = { ...headers }
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        if (value !== undefined) {
          requestHeaders[key] = value
        }
      }
    }

    const fetchFn = this.config.fetch ?? fetch
    const url = `${this.config.baseURL}/generateAssistantResponse`

    const response = await fetchFn(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(payload),
      signal: options.abortSignal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      const fs = await import("fs")
      const debugPayloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf-8")
      fs.writeFileSync("/tmp/kiro-payload-error.json", JSON.stringify({ status: response.status, statusText: response.statusText, errorText, payloadBytes: debugPayloadBytes, payload }, null, 2))
      const { APICallError } = await import("ai")
      throw new APICallError({
        message: `${response.status} ${response.statusText}`,
        url,
        requestBodyValues: payload as unknown as Record<string, unknown>,
        statusCode: response.status,
        responseBody: errorText,
        isRetryable: response.status >= 500,
      })
    }

    if (!response.body) {
      throw new Error("Response body is empty")
    }

    const warnings: LanguageModelV2CallWarning[] = []

    // Handle unsupported settings
    if (options.topK != null) {
      warnings.push({ type: "unsupported-setting", setting: "topK" })
    }
    if (options.presencePenalty != null) {
      warnings.push({ type: "unsupported-setting", setting: "presencePenalty" })
    }
    if (options.frequencyPenalty != null) {
      warnings.push({ type: "unsupported-setting", setting: "frequencyPenalty" })
    }
    if (options.seed != null) {
      warnings.push({ type: "unsupported-setting", setting: "seed" })
    }
    if (options.stopSequences != null) {
      warnings.push({ type: "unsupported-setting", setting: "stopSequences" })
    }

    const kiroStream = parseAwsEventStream(response.body)

    let finishReason: LanguageModelV2FinishReason = "unknown"
    const usage: LanguageModelV2Usage = {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    }
    let textId = crypto.randomUUID()
    let reasoningId: string | null = null
    let textStarted = false
    let reasoningStarted = false
    const toolCallIds: Map<string, string> = new Map() // toolUseId -> toolName
    let outputText = ""

    const responseHeaders = headersToRecord(response.headers)

    return {
      stream: kiroStream.pipeThrough(
        new TransformStream<KiroEvent, LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings })
          },

          transform(event, controller) {
            switch (event.type) {
              case "content":
                if (!textStarted) {
                  textStarted = true
                  controller.enqueue({
                    type: "text-start",
                    id: textId,
                  })
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: event.content,
                })
                outputText += event.content
                break

              case "thinking_start":
                reasoningId = crypto.randomUUID()
                reasoningStarted = true
                controller.enqueue({
                  type: "reasoning-start",
                  id: reasoningId,
                })
                break

              case "thinking":
                if (reasoningId) {
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: reasoningId,
                    delta: event.thinking,
                  })
                  outputText += event.thinking
                }
                break

              case "thinking_stop":
                if (reasoningId) {
                  controller.enqueue({
                    type: "reasoning-end",
                    id: reasoningId,
                  })
                  reasoningId = null
                  reasoningStarted = false
                }
                break

              case "tool_start":
                toolCallIds.set(event.toolUseId, event.name)
                controller.enqueue({
                  type: "tool-input-start",
                  id: event.toolUseId,
                  toolName: event.name,
                })
                break

              case "tool_input":
                controller.enqueue({
                  type: "tool-input-delta",
                  id: event.toolUseId,
                  delta: event.input,
                })
                break

              case "tool_stop":
                controller.enqueue({
                  type: "tool-input-end",
                  id: event.toolUseId,
                })
                const toolName = toolCallIds.get(event.toolUseId)
                if (toolName) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: event.toolUseId,
                    toolName,
                    input: typeof event.input === "string" ? event.input : JSON.stringify(event.input),
                  })
                  finishReason = "tool-calls"
                }
                break

              case "usage":
                usage.outputTokens = event.outputTokens
                if (event.inputTokens > 0) {
                  usage.inputTokens = event.inputTokens
                  usage.totalTokens = event.inputTokens + event.outputTokens
                }
                break

              case "done":
                if (finishReason === "unknown") {
                  finishReason = "stop"
                }
                break

              case "error":
                controller.enqueue({
                  type: "error",
                  error: new Error(event.error),
                })
                finishReason = "error"
                break
            }
          },

          flush(controller) {
            // Estimate tokens from payload using tiktoken (kiro-gateway style)
            if (!usage.inputTokens) {
              usage.inputTokens = estimatePayloadTokens(payload)
            }
            if (!usage.outputTokens && outputText) {
              usage.outputTokens = countTokens(outputText)
            }
            usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)

            // Close any open text part
            if (textStarted) {
              controller.enqueue({
                type: "text-end",
                id: textId,
              })
            }

            // Close any open reasoning part
            if (reasoningStarted && reasoningId) {
              controller.enqueue({
                type: "reasoning-end",
                id: reasoningId,
              })
            }

            controller.enqueue({
              type: "finish",
              finishReason,
              usage,
            })
          },
        }),
      ),
      request: { body: payload },
      response: { headers: responseHeaders },
    }
  }
}
