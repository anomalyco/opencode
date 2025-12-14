import type { LanguageModelV2, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible"
import { Log } from "@/util/log"

const log = Log.create({ service: "reasoning-model" })

/**
 * Extended OpenAI-compatible chat model that handles reasoning_content field
 * in streaming responses (used by DeepSeek, Qwen, and other models).
 *
 * This wrapper intercepts streaming chunks and transforms chunks with
 * `delta.reasoning_content` into proper reasoning-start/delta/end events.
 */
export class OpenAICompatibleChatWithReasoningLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly provider: string
  readonly modelId: string
  readonly defaultObjectGenerationMode = "json" as const

  private baseModel: OpenAICompatibleChatLanguageModel

  constructor(modelId: string, settings: ConstructorParameters<typeof OpenAICompatibleChatLanguageModel>[1]) {
    this.baseModel = new OpenAICompatibleChatLanguageModel(modelId, settings)
    this.provider = this.baseModel.provider
    this.modelId = this.baseModel.modelId

    // INFO level - will always show in logs
    log.info("wrapper initialized", {
      modelId: this.modelId,
      provider: this.provider
    })
  }

  async doGenerate(options: Parameters<LanguageModelV2["doGenerate"]>[0]) {
    return this.baseModel.doGenerate(options)
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    // Enable raw chunks so we can see reasoning_content
    const modifiedOptions = {
      ...options,
      _internal: {
        ...(options as any)._internal,
        generateId: (options as any)._internal?.generateId,
        now: (options as any)._internal?.now,
      },
    }

    // INFO level - will always show in logs
    log.info("doStream called", { modelId: this.modelId })
    const result = await this.baseModel.doStream(modifiedOptions)

    // Track reasoning state
    let currentReasoningId: string | null = null
    let reasoningStartTime: number | null = null

    // Transform the stream to handle reasoning_content
    const transformedStream = result.stream.pipeThrough(
      new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
        transform(chunk, controller) {
          // Log all chunk types for debugging
          log.debug("chunk received", { type: chunk.type })

          // Check if this is a raw chunk with reasoning_content
          if (chunk.type === "raw") {
            try {
              const rawValue = chunk.rawValue
              // Parse the chunk if it's a string (SSE format)
              const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue

              // Debug logging
              if (parsed?.choices?.[0]?.delta) {
                log.debug("delta content", { delta: parsed.choices[0].delta })
              }

              // Check for reasoning_content in delta
              const reasoningContent = parsed?.choices?.[0]?.delta?.reasoning_content
              const regularContent = parsed?.choices?.[0]?.delta?.content

              if (reasoningContent !== undefined && reasoningContent !== null) {
                log.debug("found reasoning_content", { content: reasoningContent })
                // We have reasoning content
                const reasoningId = currentReasoningId || `reasoning-${Date.now()}`

                if (!currentReasoningId) {
                  // First reasoning chunk - emit reasoning-start
                  currentReasoningId = reasoningId
                  reasoningStartTime = Date.now()

                  controller.enqueue({
                    type: "reasoning-start",
                    id: reasoningId,
                  })
                }

                // Emit reasoning-delta
                controller.enqueue({
                  type: "reasoning-delta",
                  id: reasoningId,
                  delta: reasoningContent,
                })
              } else if (currentReasoningId && regularContent !== undefined && regularContent !== null) {
                // Reasoning has ended, regular content is starting
                controller.enqueue({
                  type: "reasoning-end",
                  id: currentReasoningId,
                })

                currentReasoningId = null
                reasoningStartTime = null
              }
            } catch (e) {
              // Failed to parse or process - just pass through
            }
          }

          // Always pass through the original chunk
          controller.enqueue(chunk)
        },

        flush(controller) {
          // If reasoning was still active when stream ends, close it
          if (currentReasoningId) {
            controller.enqueue({
              type: "reasoning-end",
              id: currentReasoningId,
            })
          }
        },
      }),
    )

    return {
      ...result,
      stream: transformedStream,
    }
  }
}
