import {
  APICallError,
  type LanguageModelV2,
  type LanguageModelV2CallWarning,
  type LanguageModelV2Content,
  type LanguageModelV2FinishReason,
  type LanguageModelV2ProviderDefinedTool,
  type LanguageModelV2StreamPart,
  type LanguageModelV2Usage,
  type SharedV2ProviderMetadata,
} from "@ai-sdk/provider"
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  parseProviderOptions,
  type ParseResult,
  postJsonToApi,
} from "@ai-sdk/provider-utils"
import { z } from "zod/v4"
import type { OpenAIConfig } from "./openai-config"
import { openaiFailedResponseHandler } from "./openai-error"
import { codeInterpreterInputSchema, codeInterpreterOutputSchema } from "./tool/code-interpreter"
import { fileSearchOutputSchema } from "./tool/file-search"
import { imageGenerationOutputSchema } from "./tool/image-generation"
import { convertToOpenAIResponsesInput } from "./convert-to-openai-responses-input"
import { mapOpenAIResponseFinishReason } from "./map-openai-responses-finish-reason"
import type { OpenAIResponsesIncludeOptions, OpenAIResponsesIncludeValue } from "./openai-responses-api-types"
import { prepareResponsesTools } from "./openai-responses-prepare-tools"
import type { OpenAIResponsesModelId } from "./openai-responses-settings"
import { localShellInputSchema } from "./tool/local-shell"

const webSearchCallItem = z.object({
  type: z.literal("web_search_call"),
  id: z.string(),
  status: z.string(),
  action: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("search"),
        query: z.string().nullish(),
      }),
      z.object({
        type: z.literal("open_page"),
        url: z.string(),
      }),
      z.object({
        type: z.literal("find"),
        url: z.string(),
        pattern: z.string(),
      }),
    ])
    .nullish(),
})

const fileSearchCallItem = z.object({
  type: z.literal("file_search_call"),
  id: z.string(),
  queries: z.array(z.string()),
  results: z
    .array(
      z.object({
        attributes: z.record(z.string(), z.unknown()),
        file_id: z.string(),
        filename: z.string(),
        score: z.number(),
        text: z.string(),
      }),
    )
    .nullish(),
})

const codeInterpreterCallItem = z.object({
  type: z.literal("code_interpreter_call"),
  id: z.string(),
  code: z.string().nullable(),
  container_id: z.string(),
  outputs: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("logs"), logs: z.string() }),
        z.object({ type: z.literal("image"), url: z.string() }),
      ]),
    )
    .nullable(),
})

const localShellCallItem = z.object({
  type: z.literal("local_shell_call"),
  id: z.string(),
  call_id: z.string(),
  action: z.object({
    type: z.literal("exec"),
    command: z.array(z.string()),
    timeout_ms: z.number().optional(),
    user: z.string().optional(),
    working_directory: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
})

const imageGenerationCallItem = z.object({
  type: z.literal("image_generation_call"),
  id: z.string(),
  result: z.string(),
})

/**
 * `top_logprobs` request body argument can be set to an integer between
 * 0 and 20 specifying the number of most likely tokens to return at each
 * token position, each with an associated log probability.
 *
 * @see https://platform.openai.com/docs/api-reference/responses/create#responses_create-top_logprobs
 */
const TOP_LOGPROBS_MAX = 20

const LOGPROBS_SCHEMA = z.array(
  z.object({
    token: z.string(),
    logprob: z.number(),
    top_logprobs: z.array(
      z.object({
        token: z.string(),
        logprob: z.number(),
      }),
    ),
  }),
)

export class OpenAIResponsesLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"

  readonly modelId: OpenAIResponsesModelId

  private readonly config: OpenAIConfig

  constructor(modelId: OpenAIResponsesModelId, config: OpenAIConfig) {
    this.modelId = modelId
    this.config = config
  }

  readonly supportedUrls: Record<string, RegExp[]> = {
    "image/*": [/^https?:\/\/.*$/],
    "application/pdf": [/^https?:\/\/.*$/],
  }

  get provider(): string {
    return this.config.provider
  }

  private async getArgs({
    maxOutputTokens,
    temperature,
    stopSequences,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    seed,
    prompt,
    providerOptions,
    tools,
    toolChoice,
    responseFormat,
  }: Parameters<LanguageModelV2["doGenerate"]>[0]) {
    const warnings: LanguageModelV2CallWarning[] = []
    const modelConfig = getResponsesModelConfig(this.modelId)

    if (topK != null) {
      warnings.push({ type: "unsupported-setting", setting: "topK" })
    }

    if (seed != null) {
      warnings.push({ type: "unsupported-setting", setting: "seed" })
    }

    if (presencePenalty != null) {
      warnings.push({
        type: "unsupported-setting",
        setting: "presencePenalty",
      })
    }

    if (frequencyPenalty != null) {
      warnings.push({
        type: "unsupported-setting",
        setting: "frequencyPenalty",
      })
    }

    if (stopSequences != null) {
      warnings.push({ type: "unsupported-setting", setting: "stopSequences" })
    }

    const openaiOptions = await parseProviderOptions({
      provider: "openai",
      providerOptions,
      schema: openaiResponsesProviderOptionsSchema,
    })

    const { input, warnings: inputWarnings } = await convertToOpenAIResponsesInput({
      prompt,
      systemMessageMode: modelConfig.systemMessageMode,
      fileIdPrefixes: this.config.fileIdPrefixes,
      store: openaiOptions?.store ?? true,
      hasLocalShellTool: hasOpenAITool("openai.local_shell"),
    })

    warnings.push(...inputWarnings)

    const strictJsonSchema = openaiOptions?.strictJsonSchema ?? false

    let include: OpenAIResponsesIncludeOptions = openaiOptions?.include

    function addInclude(key: OpenAIResponsesIncludeValue) {
      include = include != null ? [...include, key] : [key]
    }

    function hasOpenAITool(id: string) {
      return tools?.find((tool) => tool.type === "provider-defined" && tool.id === id) != null
    }

    // when logprobs are requested, automatically include them:
    const topLogprobs =
      typeof openaiOptions?.logprobs === "number"
        ? openaiOptions?.logprobs
        : openaiOptions?.logprobs === true
          ? TOP_LOGPROBS_MAX
          : undefined

    if (topLogprobs) {
      addInclude("message.output_text.logprobs")
    }

    // when a web search tool is present, automatically include the sources:
    const webSearchToolName = (
      tools?.find(
        (tool) =>
          tool.type === "provider-defined" &&
          (tool.id === "openai.web_search" || tool.id === "openai.web_search_preview"),
      ) as LanguageModelV2ProviderDefinedTool | undefined
    )?.name

    if (webSearchToolName) {
      addInclude("web_search_call.action.sources")
    }

    // when a code interpreter tool is present, automatically include the outputs:
    if (hasOpenAITool("openai.code_interpreter")) {
      addInclude("code_interpreter_call.outputs")
    }

    const baseArgs = {
      model: this.modelId,
      input,
      temperature,
      top_p: topP,
      max_output_tokens: maxOutputTokens,

      ...((responseFormat?.type === "json" || openaiOptions?.textVerbosity) && {
        text: {
          ...(responseFormat?.type === "json" && {
            format:
              responseFormat.schema != null
                ? {
                    type: "json_schema",
                    strict: strictJsonSchema,
                    name: responseFormat.name ?? "response",
                    description: responseFormat.description,
                    schema: responseFormat.schema,
                  }
                : { type: "json_object" },
          }),
          ...(openaiOptions?.textVerbosity && {
            verbosity: openaiOptions.textVerbosity,
          }),
        },
      }),

      // provider options:
      max_tool_calls: openaiOptions?.maxToolCalls,
      metadata: openaiOptions?.metadata,
      parallel_tool_calls: openaiOptions?.parallelToolCalls,
      previous_response_id: openaiOptions?.previousResponseId,
      store: openaiOptions?.store,
      user: openaiOptions?.user,
      instructions: openaiOptions?.instructions,
      service_tier: openaiOptions?.serviceTier,
      include,
      prompt_cache_key: openaiOptions?.promptCacheKey,
      safety_identifier: openaiOptions?.safetyIdentifier,
      top_logprobs: topLogprobs,

      // model-specific settings:
      ...(modelConfig.isReasoningModel &&
        (openaiOptions?.reasoningEffort != null || openaiOptions?.reasoningSummary != null) && {
          reasoning: {
            ...(openaiOptions?.reasoningEffort != null && {
              effort: openaiOptions.reasoningEffort,
            }),
            ...(openaiOptions?.reasoningSummary != null && {
              summary: openaiOptions.reasoningSummary,
            }),
          },
        }),
      ...(modelConfig.requiredAutoTruncation && {
        truncation: "auto",
      }),
    }

    if (modelConfig.isReasoningModel) {
      // remove unsupported settings for reasoning models
      // see https://platform.openai.com/docs/guides/reasoning#limitations
      if (baseArgs.temperature != null) {
        baseArgs.temperature = undefined
        warnings.push({
          type: "unsupported-setting",
          setting: "temperature",
          details: "temperature is not supported for reasoning models",
        })
      }

      if (baseArgs.top_p != null) {
        baseArgs.top_p = undefined
        warnings.push({
          type: "unsupported-setting",
          setting: "topP",
          details: "topP is not supported for reasoning models",
        })
      }
    } else {
      if (openaiOptions?.reasoningEffort != null) {
        warnings.push({
          type: "unsupported-setting",
          setting: "reasoningEffort",
          details: "reasoningEffort is not supported for non-reasoning models",
        })
      }

      if (openaiOptions?.reasoningSummary != null) {
        warnings.push({
          type: "unsupported-setting",
          setting: "reasoningSummary",
          details: "reasoningSummary is not supported for non-reasoning models",
        })
      }
    }

    // Validate flex processing support
    if (openaiOptions?.serviceTier === "flex" && !modelConfig.supportsFlexProcessing) {
      warnings.push({
        type: "unsupported-setting",
        setting: "serviceTier",
        details: "flex processing is only available for o3, o4-mini, and gpt-5 models",
      })
      // Remove from args if not supported
      delete (baseArgs as any).service_tier
    }

    // Validate priority processing support
    if (openaiOptions?.serviceTier === "priority" && !modelConfig.supportsPriorityProcessing) {
      warnings.push({
        type: "unsupported-setting",
        setting: "serviceTier",
        details:
          "priority processing is only available for supported models (gpt-4, gpt-5, gpt-5-mini, o3, o4-mini) and requires Enterprise access. gpt-5-nano is not supported",
      })
      // Remove from args if not supported
      delete (baseArgs as any).service_tier
    }

    const {
      tools: openaiTools,
      toolChoice: openaiToolChoice,
      toolWarnings,
    } = prepareResponsesTools({
      tools,
      toolChoice,
      strictJsonSchema,
    })

    return {
      webSearchToolName,
      args: {
        ...baseArgs,
        tools: openaiTools,
        tool_choice: openaiToolChoice,
      },
      warnings: [...warnings, ...toolWarnings],
    }
  }

  async doGenerate(
    options: Parameters<LanguageModelV2["doGenerate"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const { args: body, warnings, webSearchToolName } = await this.getArgs(options)
    const url = this.config.url({
      path: "/responses",
      modelId: this.modelId,
    })

    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        z.object({
          id: z.string(),
          created_at: z.number(),
          error: z
            .object({
              code: z.string(),
              message: z.string(),
            })
            .nullish(),
          model: z.string(),
          output: z.array(
            z.discriminatedUnion("type", [
              z.object({
                type: z.literal("message"),
                role: z.literal("assistant"),
                id: z.string(),
                content: z.array(
                  z.object({
                    type: z.literal("output_text"),
                    text: z.string(),
                    logprobs: LOGPROBS_SCHEMA.nullish(),
                    annotations: z.array(
                      z.discriminatedUnion("type", [
                        z.object({
                          type: z.literal("url_citation"),
                          start_index: z.number(),
                          end_index: z.number(),
                          url: z.string(),
                          title: z.string(),
                        }),
                        z.object({
                          type: z.literal("file_citation"),
                          file_id: z.string(),
                          filename: z.string().nullish(),
                          index: z.number().nullish(),
                          start_index: z.number().nullish(),
                          end_index: z.number().nullish(),
                          quote: z.string().nullish(),
                        }),
                        z.object({
                          type: z.literal("container_file_citation"),
                        }),
                      ]),
                    ),
                  }),
                ),
              }),
              webSearchCallItem,
              fileSearchCallItem,
              codeInterpreterCallItem,
              imageGenerationCallItem,
              localShellCallItem,
              z.object({
                type: z.literal("function_call"),
                call_id: z.string(),
                name: z.string(),
                arguments: z.string(),
                id: z.string(),
              }),
              z.object({
                type: z.literal("computer_call"),
                id: z.string(),
                status: z.string().optional(),
              }),
              z.object({
                type: z.literal("reasoning"),
                id: z.string(),
                encrypted_content: z.string().nullish(),
                summary: z.array(
                  z.object({
                    type: z.literal("summary_text"),
                    text: z.string(),
                  }),
                ),
              }),
            ]),
          ),
          service_tier: z.string().nullish(),
          incomplete_details: z.object({ reason: z.string() }).nullish(),
          usage: usageSchema,
        }),
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    if (response.error) {
      throw new APICallError({
        message: response.error.message,
        url,
        requestBodyValues: body,
        statusCode: 400,
        responseHeaders,
        responseBody: rawResponse as string,
        isRetryable: false,
      })
    }

    const content: Array<LanguageModelV2Content> = []
    const logprobs: Array<z.infer<typeof LOGPROBS_SCHEMA>> = []

    // flag that checks if there have been client-side tool calls (not executed by openai)
    let hasFunctionCall = false

    // map response content to content array
    for (const part of response.output) {
      switch (part.type) {
        case "reasoning": {
          // when there are no summary parts, we need to add an empty reasoning part:
          if (part.summary.length === 0) {
            part.summary.push({ type: "summary_text", text: "" })
          }

          for (const summary of part.summary) {
            content.push({
              type: "reasoning" as const,
              text: summary.text,
              providerMetadata: {
                openai: {
                  itemId: part.id,
                  reasoningEncryptedContent: part.encrypted_content ?? null,
                },
              },
            })
          }
          break
        }

        case "image_generation_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: "image_generation",
            input: "{}",
            providerExecuted: true,
          })

          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: "image_generation",
            result: {
              result: part.result,
            } satisfies z.infer<typeof imageGenerationOutputSchema>,
            providerExecuted: true,
          })

          break
        }

        case "local_shell_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName: "local_shell",
            input: JSON.stringify({ action: part.action } satisfies z.infer<typeof localShellInputSchema>),
            providerMetadata: {
              openai: {
                itemId: part.id,
              },
            },
          })

          break
        }

        case "message": {
          for (const contentPart of part.content) {
            if (options.providerOptions?.openai?.logprobs && contentPart.logprobs) {
              logprobs.push(contentPart.logprobs)
            }

            content.push({
              type: "text",
              text: contentPart.text,
              providerMetadata: {
                openai: {
                  itemId: part.id,
                },
              },
            })

            for (const annotation of contentPart.annotations) {
              if (annotation.type === "url_citation") {
                content.push({
                  type: "source",
                  sourceType: "url",
                  id: this.config.generateId?.() ?? generateId(),
                  url: annotation.url,
                  title: annotation.title,
                })
              } else if (annotation.type === "file_citation") {
                content.push({
                  type: "source",
                  sourceType: "document",
                  id: this.config.generateId?.() ?? generateId(),
                  mediaType: "text/plain",
                  title: annotation.quote ?? annotation.filename ?? "Document",
                  filename: annotation.filename ?? annotation.file_id,
                })
              }
            }
          }

          break
        }

        case "function_call": {
          hasFunctionCall = true

          content.push({
            type: "tool-call",
            toolCallId: part.call_id,
            toolName: part.name,
            input: part.arguments,
            providerMetadata: {
              openai: {
                itemId: part.id,
              },
            },
          })
          break
        }

        case "web_search_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: webSearchToolName ?? "web_search",
            input: JSON.stringify({ action: part.action }),
            providerExecuted: true,
          })

          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: webSearchToolName ?? "web_search",
            result: { status: part.status },
            providerExecuted: true,
          })

          break
        }

        case "computer_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: "computer_use",
            input: "",
            providerExecuted: true,
          })

          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: "computer_use",
            result: {
              type: "computer_use_tool_result",
              status: part.status || "completed",
            },
            providerExecuted: true,
          })
          break
        }

        case "file_search_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: "file_search",
            input: "{}",
            providerExecuted: true,
          })

          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: "file_search",
            result: {
              queries: part.queries,
              results:
                part.results?.map((result) => ({
                  attributes: result.attributes,
                  fileId: result.file_id,
                  filename: result.filename,
                  score: result.score,
                  text: result.text,
                })) ?? null,
            } satisfies z.infer<typeof fileSearchOutputSchema>,
            providerExecuted: true,
          })
          break
        }

        case "code_interpreter_call": {
          content.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: "code_interpreter",
            input: JSON.stringify({
              code: part.code,
              containerId: part.container_id,
            } satisfies z.infer<typeof codeInterpreterInputSchema>),
            providerExecuted: true,
          })

          content.push({
            type: "tool-result",
            toolCallId: part.id,
            toolName: "code_interpreter",
            result: {
              outputs: part.outputs,
            } satisfies z.infer<typeof codeInterpreterOutputSchema>,
            providerExecuted: true,
          })
          break
        }
      }
    }

    const providerMetadata: SharedV2ProviderMetadata = {
      openai: { responseId: response.id },
    }

    if (logprobs.length > 0) {
      providerMetadata.openai.logprobs = logprobs
    }

    if (typeof response.service_tier === "string") {
      providerMetadata.openai.serviceTier = response.service_tier
    }

    return {
      content,
      finishReason: mapOpenAIResponseFinishReason({
        finishReason: response.incomplete_details?.reason,
        hasFunctionCall,
      }),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens ?? undefined,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? undefined,
      },
      request: { body },
      response: {
        id: response.id,
        timestamp: new Date(response.created_at * 1000),
        modelId: response.model,
        headers: responseHeaders,
        body: rawResponse,
      },
      providerMetadata,
      warnings,
    }
  }

  async doStream(
    options: Parameters<LanguageModelV2["doStream"]>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const { args: body, warnings, webSearchToolName } = await this.getArgs(options)

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({
        path: "/responses",
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: {
        ...body,
        stream: true,
      },
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(openaiResponsesChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const self = this

    let finishReason: LanguageModelV2FinishReason = "unknown"
    const usage: LanguageModelV2Usage = {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    }
    const logprobs: Array<z.infer<typeof LOGPROBS_SCHEMA>> = []
    let responseId: string | null = null
    const ongoingToolCalls: Record<
      number,
      | {
          toolName: string
          toolCallId: string
          codeInterpreter?: {
            containerId: string
          }
        }
      | undefined
    > = {}

    // flag that checks if there have been client-side tool calls (not executed by openai)
    let hasFunctionCall = false

    const activeReasoning: Record<
      string,
      {
        encryptedContent?: string | null
        summaryParts: number[]
      }
    > = {}

    // Track a stable text part id for the current assistant message.
    // Copilot may change item_id across text deltas; normalize to one id.
    let currentTextId: string | null = null

    let serviceTier: string | undefined

    return {
      stream: response.pipeThrough(
        new TransformStream<ParseResult<z.infer<typeof openaiResponsesChunkSchema>>, LanguageModelV2StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings })
          },

          transform(chunk, controller) {
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

            if (isResponseOutputItemAddedChunk(value)) {
              if (value.item.type === "function_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: value.item.name,
                  toolCallId: value.item.call_id,
                }

                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.call_id,
                  toolName: value.item.name,
                })
              } else if (value.item.type === "web_search_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: webSearchToolName ?? "web_search",
                  toolCallId: value.item.id,
                }

                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.id,
                  toolName: webSearchToolName ?? "web_search",
                })
              } else if (value.item.type === "computer_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: "computer_use",
                  toolCallId: value.item.id,
                }

                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.id,
                  toolName: "computer_use",
                })
              } else if (value.item.type === "code_interpreter_call") {
                ongoingToolCalls[value.output_index] = {
                  toolName: "code_interpreter",
                  toolCallId: value.item.id,
                  codeInterpreter: {
                    containerId: value.item.container_id,
                  },
                }

                controller.enqueue({
                  type: "tool-input-start",
                  id: value.item.id,
                  toolName: "code_interpreter",
                })

                controller.enqueue({
                  type: "tool-input-delta",
                  id: value.item.id,
                  delta: `{"containerId":"${value.item.container_id}","code":"`,
                })
              } else if (value.item.type === "file_search_call") {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.id,
                  toolName: "file_search",
                  input: "{}",
                  providerExecuted: true,
                })
              } else if (value.item.type === "image_generation_call") {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.id,
                  toolName: "image_generation",
                  input: "{}",
                  providerExecuted: true,
                })
              } else if (value.item.type === "message") {
                // Start a stable text part for this assistant message
                currentTextId = value.item.id
                controller.enqueue({
                  type: "text-start",
                  id: value.item.id,
                  providerMetadata: {
                    openai: {
                      itemId: value.item.id,
                    },
                  },
                })
              } else if (isResponseOutputItemAddedReasoningChunk(value)) {
                activeReasoning[value.item.id] = {
                  encryptedContent: value.item.encrypted_content,
                  summaryParts: [0],
                }

                controller.enqueue({
                  type: "reasoning-start",
                  id: `${value.item.id}:0`,
                  providerMetadata: {
                    openai: {
                      itemId: value.item.id,
                      reasoningEncryptedContent: value.item.encrypted_content ?? null,
                    },
                  },
                })
              }
            } else if (isResponseOutputItemDoneChunk(value)) {
              if (value.item.type === "function_call") {
                ongoingToolCalls[value.output_index] = undefined
                hasFunctionCall = true

                controller.enqueue({
                  type: "tool-input-end",
                  id: value.item.call_id,
                })

                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName: value.item.name,
                  input: value.item.arguments,
                  providerMetadata: {
                    openai: {
                      itemId: value.item.id,
                    },
                  },
                })
              } else if (value.item.type === "web_search_call") {
                ongoingToolCalls[value.output_index] = undefined

                controller.enqueue({
                  type: "tool-input-end",
                  id: value.item.id,
                })

                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.id,
                  toolName: "web_search",
                  input: JSON.stringify({ action: value.item.action }),
                  providerExecuted: true,
                })

                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: "web_search",
                  result: { status: value.item.status },
                  providerExecuted: true,
                })
              } else if (value.item.type === "computer_call") {
                ongoingToolCalls[value.output_index] = undefined

                controller.enqueue({
                  type: "tool-input-end",
                  id: value.item.id,
                })

                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.id,
                  toolName: "computer_use",
                  input: "",
                  providerExecuted: true,
                })

                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: "computer_use",
                  result: {
                    type: "computer_use_tool_result",
                    status: value.item.status || "completed",
                  },
                  providerExecuted: true,
                })
              } else if (value.item.type === "file_search_call") {
                ongoingToolCalls[value.output_index] = undefined

                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: "file_search",
                  result: {
                    queries: value.item.queries,
                    results:
                      value.item.results?.map((result) => ({
                        attributes: result.attributes,
                        fileId: result.file_id,
                        filename: result.filename,
                        score: result.score,
                        text: result.text,
                      })) ?? null,
                  } satisfies z.infer<typeof fileSearchOutputSchema>,
                  providerExecuted: true,
                })
              } else if (value.item.type === "code_interpreter_call") {
                ongoingToolCalls[value.output_index] = undefined

                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: "code_interpreter",
                  result: {
                    outputs: value.item.outputs,
                  } satisfies z.infer<typeof codeInterpreterOutputSchema>,
                  providerExecuted: true,
                })
              } else if (value.item.type === "image_generation_call") {
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: value.item.id,
                  toolName: "image_generation",
                  result: {
                    result: value.item.result,
                  } satisfies z.infer<typeof imageGenerationOutputSchema>,
                  providerExecuted: true,
                })
              } else if (value.item.type === "local_shell_call") {
                ongoingToolCalls[value.output_index] = undefined

                controller.enqueue({
                  type: "tool-call",
                  toolCallId: value.item.call_id,
                  toolName: "local_shell",
                  input: JSON.stringify({
                    action: {
                      type: "exec",
                      command: value.item.action.command,
                      timeoutMs: value.item.action.timeout_ms,
                      user: value.item.action.user,
                      workingDirectory: value.item.action.working_directory,
                      env: value.item.action.env,
                    },
                  } satisfies z.infer<typeof localShellInputSchema>),
                  providerMetadata: {
                    openai: { itemId: value.item.id },
                  },
                })
              } else if (value.item.type === "message") {
                if (currentTextId) {
                  controller.enqueue({
                    type: "text-end",
                    id: currentTextId,
                  })
                  currentTextId = null
                }
              } else if (isResponseOutputItemDoneReasoningChunk(value)) {
                const activeReasoningPart = activeReasoning[value.item.id]
                if (activeReasoningPart) {
                  for (const summaryIndex of activeReasoningPart.summaryParts) {
                    controller.enqueue({
                      type: "reasoning-end",
                      id: `${value.item.id}:${summaryIndex}`,
                      providerMetadata: {
                        openai: {
                          itemId: value.item.id,
                          reasoningEncryptedContent: value.item.encrypted_content ?? null,
                        },
                      },
                    })
                  }
                }
                delete activeReasoning[value.item.id]
              }
            } else if (isResponseFunctionCallArgumentsDeltaChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index]

              if (toolCall != null) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: value.delta,
                })
              }
            } else if (isResponseImageGenerationCallPartialImageChunk(value)) {
              controller.enqueue({
                type: "tool-result",
                toolCallId: value.item_id,
                toolName: "image_generation",
                result: {
                  result: value.partial_image_b64,
                } satisfies z.infer<typeof imageGenerationOutputSchema>,
                providerExecuted: true,
              })
            } else if (isResponseCodeInterpreterCallCodeDeltaChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index]

              if (toolCall != null) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  // The delta is code, which is embedding in a JSON string.
                  // To escape it, we use JSON.stringify and slice to remove the outer quotes.
                  delta: JSON.stringify(value.delta).slice(1, -1),
                })
              }
            } else if (isResponseCodeInterpreterCallCodeDoneChunk(value)) {
              const toolCall = ongoingToolCalls[value.output_index]

              if (toolCall != null) {
                controller.enqueue({
                  type: "tool-input-delta",
                  id: toolCall.toolCallId,
                  delta: '"}',
                })

                controller.enqueue({
                  type: "tool-input-end",
                  id: toolCall.toolCallId,
                })

                // immediately send the tool call after the input end:
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: toolCall.toolCallId,
                  toolName: "code_interpreter",
                  input: JSON.stringify({
                    code: value.code,
                    containerId: toolCall.codeInterpreter!.containerId,
                  } satisfies z.infer<typeof codeInterpreterInputSchema>),
                  providerExecuted: true,
                })
              }
            } else if (isResponseCreatedChunk(value)) {
              responseId = value.response.id
              controller.enqueue({
                type: "response-metadata",
                id: value.response.id,
                timestamp: new Date(value.response.created_at * 1000),
                modelId: value.response.model,
              })
            } else if (isTextDeltaChunk(value)) {
              // Ensure a text-start exists, and normalize deltas to a stable id
              if (!currentTextId) {
                currentTextId = value.item_id
                controller.enqueue({
                  type: "text-start",
                  id: currentTextId,
                  providerMetadata: {
                    openai: { itemId: value.item_id },
                  },
                })
              }

              controller.enqueue({
                type: "text-delta",
                id: currentTextId,
                delta: value.delta,
              })

              if (options.providerOptions?.openai?.logprobs && value.logprobs) {
                logprobs.push(value.logprobs)
              }
            } else if (isResponseReasoningSummaryPartAddedChunk(value)) {
              // the first reasoning start is pushed in isResponseOutputItemAddedReasoningChunk.
              if (value.summary_index > 0) {
                activeReasoning[value.item_id]?.summaryParts.push(value.summary_index)

                controller.enqueue({
                  type: "reasoning-start",
                  id: `${value.item_id}:${value.summary_index}`,
                  providerMetadata: {
                    openai: {
                      itemId: value.item_id,
                      reasoningEncryptedContent: activeReasoning[value.item_id]?.encryptedContent ?? null,
                    },
                  },
                })
              }
            } else if (isResponseReasoningSummaryTextDeltaChunk(value)) {
              controller.enqueue({
                type: "reasoning-delta",
                id: `${value.item_id}:${value.summary_index}`,
                delta: value.delta,
                providerMetadata: {
                  openai: {
                    itemId: value.item_id,
                  },
                },
              })
            } else if (isResponseFinishedChunk(value)) {
              finishReason = mapOpenAIResponseFinishReason({
                finishReason: value.response.incomplete_details?.reason,
                hasFunctionCall,
              })
              usage.inputTokens = value.response.usage.input_tokens
              usage.outputTokens = value.response.usage.output_tokens
              usage.totalTokens = value.response.usage.input_tokens + value.response.usage.output_tokens
              usage.reasoningTokens = value.response.usage.output_tokens_details?.reasoning_tokens ?? undefined
              usage.cachedInputTokens = value.response.usage.input_tokens_details?.cached_tokens ?? undefined
              if (typeof value.response.service_tier === "string") {
                serviceTier = value.response.service_tier
              }
            } else if (isResponseAnnotationAddedChunk(value)) {
              if (value.annotation.type === "url_citation") {
                controller.enqueue({
                  type: "source",
                  sourceType: "url",
                  id: self.config.generateId?.() ?? generateId(),
                  url: value.annotation.url,
                  title: value.annotation.title,
                })
              } else if (value.annotation.type === "file_citation") {
                controller.enqueue({
                  type: "source",
                  sourceType: "document",
                  id: self.config.generateId?.() ?? generateId(),
                  mediaType: "text/plain",
                  title: value.annotation.quote ?? value.annotation.filename ?? "Document",
                  filename: value.annotation.filename ?? value.annotation.file_id,
                })
              }
            } else if (isErrorChunk(value)) {
              controller.enqueue({ type: "error", error: value })
            }
          },

          flush(controller) {
            // Close any dangling text part
            if (currentTextId) {
              controller.enqueue({ type: "text-end", id: currentTextId })
              currentTextId = null
            }

            const providerMetadata: SharedV2ProviderMetadata = {
              openai: {
                responseId,
              },
            }

            if (logprobs.length > 0) {
              providerMetadata.openai.logprobs = logprobs
            }

            if (serviceTier !== undefined) {
              providerMetadata.openai.serviceTier = serviceTier
            }

            controller.enqueue({
              type: "finish",
              finishReason,
              usage,
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

const usageSchema = z.object({
  input_tokens: z.number(),
  input_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish(),
  output_tokens: z.number(),
  output_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
})

const textDeltaChunkSchema = z.object({
  type: z.literal("response.output_text.delta"),
  item_id: z.string(),
  delta: z.string(),
  logprobs: LOGPROBS_SCHEMA.nullish(),
})

const errorChunkSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  param: z.string().nullish(),
  sequence_number: z.number(),
})

const responseFinishedChunkSchema = z.object({
  type: z.enum(["response.completed", "response.incomplete"]),
  response: z.object({
    incomplete_details: z.object({ reason: z.string() }).nullish(),
    usage: usageSchema,
    service_tier: z.string().nullish(),
  }),
})

const responseCreatedChunkSchema = z.object({
  type: z.literal("response.created"),
  response: z.object({
    id: z.string(),
    created_at: z.number(),
    model: z.string(),
    service_tier: z.string().nullish(),
  }),
})

const responseOutputItemAddedSchema = z.object({
  type: z.literal("response.output_item.added"),
  output_index: z.number(),
  item: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("message"),
      id: z.string(),
    }),
    z.object({
      type: z.literal("reasoning"),
      id: z.string(),
      encrypted_content: z.string().nullish(),
    }),
    z.object({
      type: z.literal("function_call"),
      id: z.string(),
      call_id: z.string(),
      name: z.string(),
      arguments: z.string(),
    }),
    z.object({
      type: z.literal("web_search_call"),
      id: z.string(),
      status: z.string(),
      action: z
        .object({
          type: z.literal("search"),
          query: z.string().optional(),
        })
        .nullish(),
    }),
    z.object({
      type: z.literal("computer_call"),
      id: z.string(),
      status: z.string(),
    }),
    z.object({
      type: z.literal("file_search_call"),
      id: z.string(),
    }),
    z.object({
      type: z.literal("image_generation_call"),
      id: z.string(),
    }),
    z.object({
      type: z.literal("code_interpreter_call"),
      id: z.string(),
      container_id: z.string(),
      code: z.string().nullable(),
      outputs: z
        .array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("logs"), logs: z.string() }),
            z.object({ type: z.literal("image"), url: z.string() }),
          ]),
        )
        .nullable(),
      status: z.string(),
    }),
  ]),
})

const responseOutputItemDoneSchema = z.object({
  type: z.literal("response.output_item.done"),
  output_index: z.number(),
  item: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("message"),
      id: z.string(),
    }),
    z.object({
      type: z.literal("reasoning"),
      id: z.string(),
      encrypted_content: z.string().nullish(),
    }),
    z.object({
      type: z.literal("function_call"),
      id: z.string(),
      call_id: z.string(),
      name: z.string(),
      arguments: z.string(),
      status: z.literal("completed"),
    }),
    codeInterpreterCallItem,
    imageGenerationCallItem,
    webSearchCallItem,
    fileSearchCallItem,
    localShellCallItem,
    z.object({
      type: z.literal("computer_call"),
      id: z.string(),
      status: z.literal("completed"),
    }),
  ]),
})

const responseFunctionCallArgumentsDeltaSchema = z.object({
  type: z.literal("response.function_call_arguments.delta"),
  item_id: z.string(),
  output_index: z.number(),
  delta: z.string(),
})

const responseImageGenerationCallPartialImageSchema = z.object({
  type: z.literal("response.image_generation_call.partial_image"),
  item_id: z.string(),
  output_index: z.number(),
  partial_image_b64: z.string(),
})

const responseCodeInterpreterCallCodeDeltaSchema = z.object({
  type: z.literal("response.code_interpreter_call_code.delta"),
  item_id: z.string(),
  output_index: z.number(),
  delta: z.string(),
})

const responseCodeInterpreterCallCodeDoneSchema = z.object({
  type: z.literal("response.code_interpreter_call_code.done"),
  item_id: z.string(),
  output_index: z.number(),
  code: z.string(),
})

const responseAnnotationAddedSchema = z.object({
  type: z.literal("response.output_text.annotation.added"),
  annotation: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("url_citation"),
      url: z.string(),
      title: z.string(),
    }),
    z.object({
      type: z.literal("file_citation"),
      file_id: z.string(),
      filename: z.string().nullish(),
      index: z.number().nullish(),
      start_index: z.number().nullish(),
      end_index: z.number().nullish(),
      quote: z.string().nullish(),
    }),
  ]),
})

const responseReasoningSummaryPartAddedSchema = z.object({
  type: z.literal("response.reasoning_summary_part.added"),
  item_id: z.string(),
  summary_index: z.number(),
})

const responseReasoningSummaryTextDeltaSchema = z.object({
  type: z.literal("response.reasoning_summary_text.delta"),
  item_id: z.string(),
  summary_index: z.number(),
  delta: z.string(),
})

const openaiResponsesChunkSchema = z.union([
  textDeltaChunkSchema,
  responseFinishedChunkSchema,
  responseCreatedChunkSchema,
  responseOutputItemAddedSchema,
  responseOutputItemDoneSchema,
  responseFunctionCallArgumentsDeltaSchema,
  responseImageGenerationCallPartialImageSchema,
  responseCodeInterpreterCallCodeDeltaSchema,
  responseCodeInterpreterCallCodeDoneSchema,
  responseAnnotationAddedSchema,
  responseReasoningSummaryPartAddedSchema,
  responseReasoningSummaryTextDeltaSchema,
  errorChunkSchema,
  z.object({ type: z.string() }).loose(), // fallback for unknown chunks
])

type ExtractByType<T, K extends T extends { type: infer U } ? U : never> = T extends { type: K } ? T : never

function isTextDeltaChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof textDeltaChunkSchema> {
  return chunk.type === "response.output_text.delta"
}

function isResponseOutputItemDoneChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseOutputItemDoneSchema> {
  return chunk.type === "response.output_item.done"
}

function isResponseOutputItemDoneReasoningChunk(chunk: z.infer<typeof openaiResponsesChunkSchema>): chunk is z.infer<
  typeof responseOutputItemDoneSchema
> & {
  item: ExtractByType<z.infer<typeof responseOutputItemDoneSchema>["item"], "reasoning">
} {
  return isResponseOutputItemDoneChunk(chunk) && chunk.item.type === "reasoning"
}

function isResponseFinishedChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseFinishedChunkSchema> {
  return chunk.type === "response.completed" || chunk.type === "response.incomplete"
}

function isResponseCreatedChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseCreatedChunkSchema> {
  return chunk.type === "response.created"
}

function isResponseFunctionCallArgumentsDeltaChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseFunctionCallArgumentsDeltaSchema> {
  return chunk.type === "response.function_call_arguments.delta"
}
function isResponseImageGenerationCallPartialImageChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseImageGenerationCallPartialImageSchema> {
  return chunk.type === "response.image_generation_call.partial_image"
}

function isResponseCodeInterpreterCallCodeDeltaChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseCodeInterpreterCallCodeDeltaSchema> {
  return chunk.type === "response.code_interpreter_call_code.delta"
}

function isResponseCodeInterpreterCallCodeDoneChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseCodeInterpreterCallCodeDoneSchema> {
  return chunk.type === "response.code_interpreter_call_code.done"
}

function isResponseOutputItemAddedChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseOutputItemAddedSchema> {
  return chunk.type === "response.output_item.added"
}

function isResponseOutputItemAddedReasoningChunk(chunk: z.infer<typeof openaiResponsesChunkSchema>): chunk is z.infer<
  typeof responseOutputItemAddedSchema
> & {
  item: ExtractByType<z.infer<typeof responseOutputItemAddedSchema>["item"], "reasoning">
} {
  return isResponseOutputItemAddedChunk(chunk) && chunk.item.type === "reasoning"
}

function isResponseAnnotationAddedChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseAnnotationAddedSchema> {
  return chunk.type === "response.output_text.annotation.added"
}

function isResponseReasoningSummaryPartAddedChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseReasoningSummaryPartAddedSchema> {
  return chunk.type === "response.reasoning_summary_part.added"
}

function isResponseReasoningSummaryTextDeltaChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseReasoningSummaryTextDeltaSchema> {
  return chunk.type === "response.reasoning_summary_text.delta"
}

function isErrorChunk(chunk: z.infer<typeof openaiResponsesChunkSchema>): chunk is z.infer<typeof errorChunkSchema> {
  return chunk.type === "error"
}

type ResponsesModelConfig = {
  isReasoningModel: boolean
  systemMessageMode: "remove" | "system" | "developer"
  requiredAutoTruncation: boolean
  supportsFlexProcessing: boolean
  supportsPriorityProcessing: boolean
}

function getResponsesModelConfig(modelId: string): ResponsesModelConfig {
  const supportsFlexProcessing =
    modelId.startsWith("o3") ||
    modelId.startsWith("o4-mini") ||
    (modelId.startsWith("gpt-5") && !modelId.startsWith("gpt-5-chat"))
  const supportsPriorityProcessing =
    modelId.startsWith("gpt-4") ||
    modelId.startsWith("gpt-5-mini") ||
    (modelId.startsWith("gpt-5") && !modelId.startsWith("gpt-5-nano") && !modelId.startsWith("gpt-5-chat")) ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4-mini")
  const defaults = {
    requiredAutoTruncation: false,
    systemMessageMode: "system" as const,
    supportsFlexProcessing,
    supportsPriorityProcessing,
  }

  // gpt-5-chat models are non-reasoning
  if (modelId.startsWith("gpt-5-chat")) {
    return {
      ...defaults,
      isReasoningModel: false,
    }
  }

  // o series reasoning models:
  if (
    modelId.startsWith("o") ||
    modelId.startsWith("gpt-5") ||
    modelId.startsWith("codex-") ||
    modelId.startsWith("computer-use")
  ) {
    if (modelId.startsWith("o1-mini") || modelId.startsWith("o1-preview")) {
      return {
        ...defaults,
        isReasoningModel: true,
        systemMessageMode: "remove",
      }
    }

    return {
      ...defaults,
      isReasoningModel: true,
      systemMessageMode: "developer",
    }
  }

  // gpt models:
  return {
    ...defaults,
    isReasoningModel: false,
  }
}

// TODO AI SDK 6: use optional here instead of nullish
const openaiResponsesProviderOptionsSchema = z.object({
  include: z
    .array(z.enum(["reasoning.encrypted_content", "file_search_call.results", "message.output_text.logprobs"]))
    .nullish(),
  instructions: z.string().nullish(),

  /**
   * Return the log probabilities of the tokens.
   *
   * Setting to true will return the log probabilities of the tokens that
   * were generated.
   *
   * Setting to a number will return the log probabilities of the top n
   * tokens that were generated.
   *
   * @see https://platform.openai.com/docs/api-reference/responses/create
   * @see https://cookbook.openai.com/examples/using_logprobs
   */
  logprobs: z.union([z.boolean(), z.number().min(1).max(TOP_LOGPROBS_MAX)]).optional(),

  /**
   * The maximum number of total calls to built-in tools that can be processed in a response.
   * This maximum number applies across all built-in tool calls, not per individual tool.
   * Any further attempts to call a tool by the model will be ignored.
   */
  maxToolCalls: z.number().nullish(),

  metadata: z.any().nullish(),
  parallelToolCalls: z.boolean().nullish(),
  previousResponseId: z.string().nullish(),
  promptCacheKey: z.string().nullish(),
  reasoningEffort: z.string().nullish(),
  reasoningSummary: z.string().nullish(),
  safetyIdentifier: z.string().nullish(),
  serviceTier: z.enum(["auto", "flex", "priority"]).nullish(),
  store: z.boolean().nullish(),
  strictJsonSchema: z.boolean().nullish(),
  textVerbosity: z.enum(["low", "medium", "high"]).nullish(),
  user: z.string().nullish(),
})

export type OpenAIResponsesProviderOptions = z.infer<typeof openaiResponsesProviderOptionsSchema>
