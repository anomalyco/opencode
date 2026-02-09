import {
  APICallError,
  InvalidResponseDataError,
  type LanguageModelV2,
  type LanguageModelV2CallWarning,
  type LanguageModelV2Content,
  type LanguageModelV2FinishReason,
  type LanguageModelV2StreamPart,
  type SharedV2ProviderMetadata,
} from "@ai-sdk/provider"
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  type FetchFunction,
  generateId,
  isParsableJson,
  parseProviderOptions,
  type ParseResult,
  postJsonToApi,
  type ResponseHandler,
} from "@ai-sdk/provider-utils"
import { z } from "zod/v4"
import { convertToOpenAICompatibleChatMessages } from "./convert-to-openai-compatible-chat-messages"
import { getResponseMetadata } from "./get-response-metadata"
import { mapOpenAICompatibleFinishReason } from "./map-openai-compatible-finish-reason"
import { type OpenAICompatibleChatModelId, openaiCompatibleProviderOptions } from "./openai-compatible-chat-options"
import { defaultOpenAICompatibleErrorStructure, type ProviderErrorStructure } from "../openai-compatible-error"
import type { MetadataExtractor } from "./openai-compatible-metadata-extractor"
import { prepareTools } from "./openai-compatible-prepare-tools"

export type OpenAICompatibleChatConfig = {
  provider: string
  headers: () => Record<string, string | undefined>
  url: (options: { modelId: string; path: string }) => string
  fetch?: FetchFunction
  includeUsage?: boolean
  errorStructure?: ProviderErrorStructure<any>
  metadataExtractor?: MetadataExtractor

  /**
   * Whether the model supports structured outputs.
   */
  supportsStructuredOutputs?: boolean

  /**
   * The supported URLs for the model.
   */
  supportedUrls?: () => LanguageModelV2["supportedUrls"]
}

export class OpenAICompatibleChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"

  readonly supportsStructuredOutputs: boolean

  readonly modelId: OpenAICompatibleChatModelId
  private readonly config: OpenAICompatibleChatConfig
  private readonly failedResponseHandler: ResponseHandler<APICallError>
  private readonly chunkSchema // type inferred via constructor

  constructor(modelId: OpenAICompatibleChatModelId, config: OpenAICompatibleChatConfig) {
    this.modelId = modelId
    this.config = config

    // initialize error handling:
    const errorStructure = config.errorStructure ?? defaultOpenAICompatibleErrorStructure
    this.chunkSchema = createOpenAICompatibleChatChunkSchema(errorStructure.errorSchema)
    this.failedResponseHandler = createJsonErrorResponseHandler(errorStructure)

    this.supportsStructuredOutputs = config.supportsStructuredOutputs ?? false
  }

  get provider(): string {
    return this.config.provider
  }

  private get providerOptionsName(): string {
    return this.config.provider.split(".")[0].trim()
  }

  get supportedUrls() {
    return this.config.supportedUrls?.() ?? {}
  }

  private async getArgs({
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    providerOptions,
    stopSequences,
    responseFormat,
    seed,
    toolChoice,
    tools,
  }: Parameters<LanguageModelV2["doGenerate"]>[0]) {
    const warnings: LanguageModelV2CallWarning[] = []

    // Parse provider options
    const compatibleOptions = Object.assign(
      (await parseProviderOptions({
        provider: "copilot",
        providerOptions,
        schema: openaiCompatibleProviderOptions,
      })) ?? {},
      (await parseProviderOptions({
        provider: this.providerOptionsName,
        providerOptions,
        schema: openaiCompatibleProviderOptions,
      })) ?? {},
    )

    if (topK != null) {
      warnings.push({ type: "unsupported-setting", setting: "topK" })
    }

    if (responseFormat?.type === "json" && responseFormat.schema != null && !this.supportsStructuredOutputs) {
      warnings.push({
        type: "unsupported-setting",
        setting: "responseFormat",
        details: "JSON response format schema is only supported with structuredOutputs",
      })
    }

    const {
      tools: openaiTools,
      toolChoice: openaiToolChoice,
      toolWarnings,
    } = prepareTools({
      tools,
      toolChoice,
    })

    return {
      args: {
        // model id:
        model: this.modelId,

        // model specific settings:
        user: compatibleOptions.user,

        // standardized settings:
        max_tokens: maxOutputTokens,
        temperature,
        top_p: topP,
        frequency_penalty: frequencyPenalty,
        presence_penalty: presencePenalty,
        response_format:
          responseFormat?.type === "json"
            ? this.supportsStructuredOutputs === true && responseFormat.schema != null
              ? {
                  type: "json_schema",
                  json_schema: {
                    schema: responseFormat.schema,
                    name: responseFormat.name ?? "response",
                    description: responseFormat.description,
                  },
                }
              : { type: "json_object" }
            : undefined,

        stop: stopSequences,
        seed,
        ...Object.fromEntries(
          Object.entries(providerOptions?.[this.providerOptionsName] ?? {}).filter(
            ([key]) => !Object.keys(openaiCompatibleProviderOptions.shape).includes(key),
          ),
        ),

        reasoning_effort: compatibleOptions.reasoningEffort,
        verbosity: compatibleOptions.textVerbosity,

        // messages:
        messages: convertToOpenAICompatibleChatMessages(prompt),

        // tools:
        tools: openaiTools,
        tool_choice: openaiToolChoice,

        // thinking_budget
        thinking_budget: compatibleOptions.thinking_budget,
      },
      warnings: [...warnings, ...toolWarnings],
    }
  }

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const { args, warnings } = await this.getArgs({ ...options })

    const body = JSON.stringify(args)

    const {
      responseHeaders,
      value: responseBody,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(OpenAICompatibleChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const choice = responseBody.choices[0]
    const content: Array<LanguageModelV2Content> = []

    // text content:
    const text = choice.message.content
    if (text != null && text.length > 0) {
      content.push({
        type: "text",
        text,
        providerMetadata: choice.message.reasoning_opaque
          ? { copilot: { reasoningOpaque: choice.message.reasoning_opaque } }
          : undefined,
      })
    }

    // reasoning content (Copilot uses reasoning_text):
    const reasoning = choice.message.reasoning_text
    if (reasoning != null && reasoning.length > 0) {
      content.push({
        type: "reasoning",
        text: reasoning,
        // Include reasoning_opaque for Copilot multi-turn reasoning
        providerMetadata: choice.message.reasoning_opaque
          ? { copilot: { reasoningOpaque: choice.message.reasoning_opaque } }
          : undefined,
      })
    }

    // tool calls:
    if (choice.message.tool_calls != null) {
      for (const toolCall of choice.message.tool_calls) {
        content.push({
          type: "tool-call",
          toolCallId: toolCall.id ?? generateId(),
          toolName: toolCall.function.name,
          input: toolCall.function.arguments!,
          providerMetadata: choice.message.reasoning_opaque
            ? { copilot: { reasoningOpaque: choice.message.reasoning_opaque } }
            : undefined,
        })
      }
    }

    // provider metadata:
    const providerMetadata: SharedV2ProviderMetadata = {
      [this.providerOptionsName]: {},
      ...(await this.config.metadataExtractor?.extractMetadata?.({
        parsedBody: rawResponse,
      })),
    }
    const completionTokenDetails = responseBody.usage?.completion_tokens_details
    if (completionTokenDetails?.accepted_prediction_tokens != null) {
      providerMetadata[this.providerOptionsName].acceptedPredictionTokens =
        completionTokenDetails?.accepted_prediction_tokens
    }
    if (completionTokenDetails?.rejected_prediction_tokens != null) {
      providerMetadata[this.providerOptionsName].rejectedPredictionTokens =
        completionTokenDetails?.rejected_prediction_tokens
    }

    return {
      content,
      finishReason: mapOpenAICompatibleFinishReason(choice.finish_reason),
      usage: {
        inputTokens: responseBody.usage?.prompt_tokens ?? undefined,
        outputTokens: responseBody.usage?.completion_tokens ?? undefined,
        totalTokens: responseBody.usage?.total_tokens ?? undefined,
        reasoningTokens: responseBody.usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
        cachedInputTokens: responseBody.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
      },
      providerMetadata,
      request: { body },
      response: {
        ...getResponseMetadata(responseBody),
        headers: responseHeaders,
        body: rawResponse,
      },
      warnings,
    }
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const { args, warnings } = await this.getArgs({ ...options })

    const body = {
      ...args,
      stream: true,

      // only include stream_options when in strict compatibility mode:
      stream_options: this.config.includeUsage ? { include_usage: true } : undefined,
    }

    const metadataExtractor = this.config.metadataExtractor?.createStreamExtractor()

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({
        path: "/chat/completions",
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: this.failedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(this.chunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const toolCalls: Array<{
      id: string
      type: "function"
      function: {
        name: string
        arguments: string
      }
      hasFinished: boolean
    }> = []

    let finishReason: LanguageModelV2FinishReason = "unknown"
    const usage: {
      completionTokens: number | undefined
      completionTokensDetails: {
        reasoningTokens: number | undefined
        acceptedPredictionTokens: number | undefined
        rejectedPredictionTokens: number | undefined
      }
      promptTokens: number | undefined
      promptTokensDetails: {
        cachedTokens: number | undefined
      }
      totalTokens: number | undefined
    } = {
      completionTokens: undefined,
      completionTokensDetails: {
        reasoningTokens: undefined,
        acceptedPredictionTokens: undefined,
        rejectedPredictionTokens: undefined,
      },
      promptTokens: undefined,
      promptTokensDetails: {
        cachedTokens: undefined,
      },
      totalTokens: undefined,
    }
    let isFirstChunk = true
    const providerOptionsName = this.providerOptionsName
    let isActiveReasoning = false
    let isActiveText = false
    let reasoningOpaque: string | undefined

    return {
      stream: response.pipeThrough(
        new TransformStream<ParseResult<z.infer<typeof this.chunkSchema>>, LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings })
          },

          // TODO we lost type safety on Chunk, most likely due to the error schema. MUST FIX
          transform(chunk, controller) {
            // Emit raw chunk if requested (before anything else)
            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk.rawValue })
            }

            // handle failed chunk parsing / validation:
            if (!chunk.success) {
              finishReason = "error"
              controller.enqueue({ type: "error", error: chunk.error })
              return
            }
            const value = chunk.value

            metadataExtractor?.processChunk(chunk.rawValue)

            // handle error chunks:
            if ("error" in value) {
              finishReason = "error"
              controller.enqueue({ type: "error", error: value.error.message })
              return
            }

            if (isFirstChunk) {
              isFirstChunk = false

              controller.enqueue({
                type: "response-metadata",
                ...getResponseMetadata(value),
              })
            }

            if (value.usage != null) {
              const {
                prompt_tokens,
                completion_tokens,
                total_tokens,
                prompt_tokens_details,
                completion_tokens_details,
              } = value.usage

              usage.promptTokens = prompt_tokens ?? undefined
              usage.completionTokens = completion_tokens ?? undefined
              usage.totalTokens = total_tokens ?? undefined
              if (completion_tokens_details?.reasoning_tokens != null) {
                usage.completionTokensDetails.reasoningTokens = completion_tokens_details?.reasoning_tokens
              }
              if (completion_tokens_details?.accepted_prediction_tokens != null) {
                usage.completionTokensDetails.acceptedPredictionTokens =
                  completion_tokens_details?.accepted_prediction_tokens
              }
              if (completion_tokens_details?.rejected_prediction_tokens != null) {
                usage.completionTokensDetails.rejectedPredictionTokens =
                  completion_tokens_details?.rejected_prediction_tokens
              }
              if (prompt_tokens_details?.cached_tokens != null) {
                usage.promptTokensDetails.cachedTokens = prompt_tokens_details?.cached_tokens
              }
            }

            const choice = value.choices[0]

            if (choice?.finish_reason != null) {
              finishReason = mapOpenAICompatibleFinishReason(choice.finish_reason)
            }

            if (choice?.delta == null) {
              return
            }

            const delta = choice.delta

            // Capture reasoning_opaque for Copilot multi-turn reasoning
            if (delta.reasoning_opaque) {
              if (reasoningOpaque != null) {
                throw new InvalidResponseDataError({
                  data: delta,
                  message:
                    "Multiple reasoning_opaque values received in a single response. Only one thinking part per response is supported.",
                })
              }
              reasoningOpaque = delta.reasoning_opaque
            }

            // enqueue reasoning before text deltas (Copilot uses reasoning_text):
            const reasoningContent = delta.reasoning_text
            if (reasoningContent) {
              if (!isActiveReasoning) {
                controller.enqueue({
                  type: "reasoning-start",
                  id: "reasoning-0",
                })
                isActiveReasoning = true
              }

              controller.enqueue({
                type: "reasoning-delta",
                id: "reasoning-0",
                delta: reasoningContent,
              })
            }

            if (delta.content) {
              // If reasoning was active and we're starting text, end reasoning first
              // This handles the case where reasoning_opaque and content come in the same chunk
              if (isActiveReasoning && !isActiveText) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: "reasoning-0",
                  providerMetadata: reasoningOpaque ? { copilot: { reasoningOpaque } } : undefined,
                })
                isActiveReasoning = false
              }

              if (!isActiveText) {
                controller.enqueue({
                  type: "text-start",
                  id: "txt-0",
                  providerMetadata: reasoningOpaque ? { copilot: { reasoningOpaque } } : undefined,
                })
                isActiveText = true
              }

              controller.enqueue({
                type: "text-delta",
                id: "txt-0",
                delta: delta.content,
              })
            }

            if (delta.tool_calls != null) {
              // If reasoning was active and we're starting tool calls, end reasoning first
              // This handles the case where reasoning goes directly to tool calls with no content
              if (isActiveReasoning) {
                controller.enqueue({
                  type: "reasoning-end",
                  id: "reasoning-0",
                  providerMetadata: reasoningOpaque ? { copilot: { reasoningOpaque } } : undefined,
                })
                isActiveReasoning = false
              }
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index

                if (toolCalls[index] == null) {
                  if (toolCallDelta.id == null) {
                    throw new InvalidResponseDataError({
                      data: toolCallDelta,
                      message: `Expected 'id' to be a string.`,
                    })
                  }

                  if (toolCallDelta.function?.name == null) {
                    throw new InvalidResponseDataError({
                      data: toolCallDelta,
                      message: `Expected 'function.name' to be a string.`,
                    })
                  }

                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolCallDelta.id,
                    toolName: toolCallDelta.function.name,
                  })

                  toolCalls[index] = {
                    id: toolCallDelta.id,
                    type: "function",
                    function: {
                      name: toolCallDelta.function.name,
                      arguments: toolCallDelta.function.arguments ?? "",
                    },
                    hasFinished: false,
                  }

                  const toolCall = toolCalls[index]

                  if (toolCall.function?.name != null && toolCall.function?.arguments != null) {
                    // send delta if the argument text has already started:
                    if (toolCall.function.arguments.length > 0) {
                      controller.enqueue({
                        type: "tool-input-delta",
                        id: toolCall.id,
                        delta: toolCall.function.arguments,
                      })
                    }

                    // check if tool call is complete
                    // (some providers send the full tool call in one chunk):
                    if (isParsableJson(toolCall.function.arguments)) {
                      controller.enqueue({
                        type: "tool-input-end",
                        id: toolCall.id,
                      })

                      controller.enqueue({
                        type: "tool-call",
                        toolCallId: toolCall.id ?? generateId(),
                        toolName: toolCall.function.name,
                        input: toolCall.function.arguments,
                        providerMetadata: reasoningOpaque ? { copilot: { reasoningOpaque } } : undefined,
                      })
                      toolCall.hasFinished = true
                    }
                  }

                  continue
                }

                // existing tool call, merge if not finished
                const toolCall = toolCalls[index]

                if (toolCall.hasFinished) {
                  continue
                }

                if (toolCallDelta.function?.arguments != null) {
                  toolCall.function!.arguments += toolCallDelta.function?.arguments ?? ""
                }

                // send delta
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.id,
                  delta: toolCallDelta.function.arguments ?? "",
                })

                // check if tool call is complete
                if (
                  toolCall.function?.name != null &&
                  toolCall.function?.arguments != null &&
                  isParsableJson(toolCall.function.arguments)
                ) {
                  controller.enqueue({
                    type: "tool-input-end",
                    id: toolCall.id,
                  })

                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: toolCall.id ?? generateId(),
                    toolName: toolCall.function.name,
                    input: toolCall.function.arguments,
                    providerMetadata: reasoningOpaque ? { copilot: { reasoningOpaque } } : undefined,
                  })
                  toolCall.hasFinished = true
                }
              }
            }
          },

          flush(controller) {
            if (isActiveReasoning) {
              controller.enqueue({
                type: "reasoning-end",
                id: "reasoning-0",
                // Include reasoning_opaque for Copilot multi-turn reasoning
                providerMetadata: reasoningOpaque ? { copilot: { reasoningOpaque } } : undefined,
              })
            }

            if (isActiveText) {
              controller.enqueue({ type: "text-end", id: "txt-0" })
            }

            // go through all tool calls and send the ones that are not finished
            for (const toolCall of toolCalls.filter((toolCall) => !toolCall.hasFinished)) {
              controller.enqueue({
                type: "tool-input-end",
                id: toolCall.id,
              })

              controller.enqueue({
                type: "tool-call",
                toolCallId: toolCall.id ?? generateId(),
                toolName: toolCall.function.name,
                input: toolCall.function.arguments,
              })
            }

            const providerMetadata: SharedV2ProviderMetadata = {
              [providerOptionsName]: {},
              // Include reasoning_opaque for Copilot multi-turn reasoning
              ...(reasoningOpaque ? { copilot: { reasoningOpaque } } : {}),
              ...metadataExtractor?.buildMetadata(),
            }
            if (usage.completionTokensDetails.acceptedPredictionTokens != null) {
              providerMetadata[providerOptionsName].acceptedPredictionTokens =
                usage.completionTokensDetails.acceptedPredictionTokens
            }
            if (usage.completionTokensDetails.rejectedPredictionTokens != null) {
              providerMetadata[providerOptionsName].rejectedPredictionTokens =
                usage.completionTokensDetails.rejectedPredictionTokens
            }

            controller.enqueue({
              type: "finish",
              finishReason,
              usage: {
                inputTokens: usage.promptTokens ?? undefined,
                outputTokens: usage.completionTokens ?? undefined,
                totalTokens: usage.totalTokens ?? undefined,
                reasoningTokens: usage.completionTokensDetails.reasoningTokens ?? undefined,
                cachedInputTokens: usage.promptTokensDetails.cachedTokens ?? undefined,
              },
              providerMetadata,
            })
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    }
  }
}

const openaiCompatibleTokenUsageSchema = z
  .object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().nullish(),
      })
      .nullish(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number().nullish(),
        accepted_prediction_tokens: z.number().nullish(),
        rejected_prediction_tokens: z.number().nullish(),
      })
      .nullish(),
  })
  .nullish()

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const OpenAICompatibleChatResponseSchema = z.object({
  id: z.string().nullish(),
  created: z.number().nullish(),
  model: z.string().nullish(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal("assistant").nullish(),
        content: z.string().nullish(),
        // Copilot-specific reasoning fields
        reasoning_text: z.string().nullish(),
        reasoning_opaque: z.string().nullish(),
        tool_calls: z
          .array(
            z.object({
              id: z.string().nullish(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .nullish(),
      }),
      finish_reason: z.string().nullish(),
    }),
  ),
  usage: openaiCompatibleTokenUsageSchema,
})

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const createOpenAICompatibleChatChunkSchema = <ERROR_SCHEMA extends z.core.$ZodType>(errorSchema: ERROR_SCHEMA) =>
  z.union([
    z.object({
      id: z.string().nullish(),
      created: z.number().nullish(),
      model: z.string().nullish(),
      choices: z.array(
        z.object({
          delta: z
            .object({
              role: z.enum(["assistant"]).nullish(),
              content: z.string().nullish(),
              // Copilot-specific reasoning fields
              reasoning_text: z.string().nullish(),
              reasoning_opaque: z.string().nullish(),
              tool_calls: z
                .array(
                  z.object({
                    index: z.number(),
                    id: z.string().nullish(),
                    function: z.object({
                      name: z.string().nullish(),
                      arguments: z.string().nullish(),
                    }),
                  }),
                )
                .nullish(),
            })
            .nullish(),
          finish_reason: z.string().nullish(),
        }),
      ),
      usage: openaiCompatibleTokenUsageSchema,
    }),
    errorSchema,
  ])
