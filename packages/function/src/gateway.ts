import { Hono, Context, Next } from "hono"
import { Resource } from "sst"
import { generateText, streamText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { type LanguageModelV2Prompt } from "@ai-sdk/provider"
import { type ChatCompletionCreateParamsBase } from "openai/resources/chat/completions"

type Env = {}

const auth = async (c: Context, next: Next) => {
  const authHeader = c.req.header("authorization")

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: {
          message: "Missing API key.",
          type: "invalid_request_error",
          param: null,
          code: "unauthorized",
        },
      },
      401,
    )
  }

  const apiKey = authHeader.split(" ")[1]

  // Replace with your validation logic
  if (apiKey !== Resource.OPENCODE_API_KEY.value) {
    return c.json(
      {
        error: {
          message: "Invalid API key.",
          type: "invalid_request_error",
          param: null,
          code: "unauthorized",
        },
      },
      401,
    )
  }

  await next()
}
export default new Hono<{ Bindings: Env }>()
  .get("/", (c) => c.text("Hello, world!"))
  .post("/v1/chat/completions", auth, async (c) => {
    try {
      const body = await c.req.json<ChatCompletionCreateParamsBase>()

      console.log(body)

      const model = (() => {
        const [provider, ...parts] = body.model.split("/")
        const model = parts.join("/")
        if (provider === "anthropic" && model === "claude-sonnet-4") {
          return createAnthropic({
            apiKey: Resource.ANTHROPIC_API_KEY.value,
          })("claude-sonnet-4-20250514")
        }
        if (provider === "openai" && model === "gpt-4.1") {
          return createOpenAI({
            apiKey: Resource.OPENAI_API_KEY.value,
          })("gpt-4.1")
        }
        if (provider === "zhipuai" && model === "glm-4.5-flash") {
          return createOpenAICompatible({
            name: "Zhipu AI",
            baseURL: "https://api.z.ai/api/paas/v4",
            apiKey: Resource.ZHIPU_API_KEY.value,
          })("glm-4.5-flash")
        }
        throw new Error(`Unsupported provider: ${provider}`)
      })()

      const requestBody = transformOpenAIRequestToAiSDK()

      return body.stream ? await handleStream() : await handleGenerate()

      async function handleStream() {
        const result = await streamText({
          model,
          ...requestBody,
        })

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const id = `chatcmpl-${Date.now()}`
            const created = Math.floor(Date.now() / 1000)

            try {
              for await (const chunk of result.fullStream) {
                // TODO
                //console.log("!!! CHUCK !!!", chunk);
                switch (chunk.type) {
                  case "text-delta": {
                    const data = {
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model: body.model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            content: chunk.text,
                          },
                          finish_reason: null,
                        },
                      ],
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                    break
                  }

                  case "reasoning-delta": {
                    const data = {
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model: body.model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            reasoning_content: chunk.text,
                          },
                          finish_reason: null,
                        },
                      ],
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                    break
                  }

                  case "tool-call": {
                    const data = {
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model: body.model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                id: chunk.toolCallId,
                                type: "function",
                                function: {
                                  name: chunk.toolName,
                                  arguments: JSON.stringify(chunk.input),
                                },
                              },
                            ],
                          },
                          finish_reason: null,
                        },
                      ],
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                    break
                  }

                  case "error": {
                    const data = {
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model: body.model,
                      error: {
                        message: chunk.error,
                        type: "server_error",
                      },
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                    controller.close()
                    break
                  }

                  case "finish": {
                    const finishReason =
                      {
                        stop: "stop",
                        length: "length",
                        "content-filter": "content_filter",
                        "tool-calls": "tool_calls",
                        error: "stop",
                        other: "stop",
                        unknown: "stop",
                      }[chunk.finishReason] || "stop"

                    const data = {
                      id,
                      object: "chat.completion.chunk",
                      created,
                      model: body.model,
                      choices: [
                        {
                          index: 0,
                          delta: {},
                          finish_reason: finishReason,
                        },
                      ],
                      usage: {
                        prompt_tokens: chunk.totalUsage.inputTokens,
                        completion_tokens: chunk.totalUsage.outputTokens,
                        total_tokens: chunk.totalUsage.totalTokens,
                        completion_tokens_details: {
                          reasoning_tokens: chunk.totalUsage.reasoningTokens,
                        },
                        prompt_tokens_details: {
                          cached_tokens: chunk.totalUsage.cachedInputTokens,
                        },
                      },
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"))
                    controller.close()
                    break
                  }

                  //case "stream-start":
                  //case "response-metadata":
                  case "start-step":
                  case "finish-step":
                  case "text-start":
                  case "text-end":
                  case "reasoning-start":
                  case "reasoning-end":
                  case "tool-input-start":
                  case "tool-input-delta":
                  case "tool-input-end":
                  case "raw":
                  default:
                    // Log unknown chunk types for debugging
                    console.warn(`Unknown chunk type: ${(chunk as any).type}`)
                    break
                }
              }
            } catch (error) {
              controller.error(error)
            }
          },
        })

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
      }

      async function handleGenerate() {
        const response = await generateText({
          model,
          ...requestBody,
        })
        return c.json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion" as const,
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant" as const,
                content: response.content?.find((c) => c.type === "text")?.text ?? "",
                reasoning_content: response.content?.find((c) => c.type === "reasoning")?.text,
                tool_calls: response.content
                  ?.filter((c) => c.type === "tool-call")
                  .map((toolCall) => ({
                    id: toolCall.toolCallId,
                    type: "function" as const,
                    function: {
                      name: toolCall.toolName,
                      arguments: toolCall.input,
                    },
                  })),
              },
              finish_reason:
                (
                  {
                    stop: "stop",
                    length: "length",
                    "content-filter": "content_filter",
                    "tool-calls": "tool_calls",
                    error: "stop",
                    other: "stop",
                    unknown: "stop",
                  } as const
                )[response.finishReason] || "stop",
            },
          ],
          usage: {
            prompt_tokens: response.usage?.inputTokens,
            completion_tokens: response.usage?.outputTokens,
            total_tokens: response.usage?.totalTokens,
            completion_tokens_details: {
              reasoning_tokens: response.usage?.reasoningTokens,
            },
            prompt_tokens_details: {
              cached_tokens: response.usage?.cachedInputTokens,
            },
          },
        })
      }

      function transformOpenAIRequestToAiSDK() {
        const prompt = transformMessages()

        return {
          prompt,
          maxOutputTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
          temperature: body.temperature ?? undefined,
          topP: body.top_p ?? undefined,
          frequencyPenalty: body.frequency_penalty ?? undefined,
          presencePenalty: body.presence_penalty ?? undefined,
          providerOptions: body.reasoning_effort
            ? {
                anthropic: {
                  reasoningEffort: body.reasoning_effort,
                },
              }
            : undefined,
          stopSequences: (typeof body.stop === "string" ? [body.stop] : body.stop) ?? undefined,
          responseFormat: (() => {
            if (!body.response_format) return { type: "text" }
            if (body.response_format.type === "json_schema")
              return {
                type: "json",
                schema: body.response_format.json_schema.schema,
                name: body.response_format.json_schema.name,
                description: body.response_format.json_schema.description,
              }
            if (body.response_format.type === "json_object") return { type: "json" }
            throw new Error("Unsupported response format")
          })(),
          seed: body.seed ?? undefined,
        }

        function transformTools() {
          const { tools, tool_choice } = body

          if (!tools || tools.length === 0) {
            return { tools: undefined, toolChoice: undefined }
          }

          const aiSdkTools = tools.reduce(
            (acc, tool) => {
              acc[tool.function.name] = {
                type: "function" as const,
                name: tool.function.name,
                description: tool.function.description,
                inputSchema: tool.function.parameters,
              }
              return acc
            },
            {} as Record<string, any>,
          )

          let aiSdkToolChoice
          if (tool_choice == null) {
            aiSdkToolChoice = undefined
          } else if (tool_choice === "auto") {
            aiSdkToolChoice = "auto"
          } else if (tool_choice === "none") {
            aiSdkToolChoice = "none"
          } else if (tool_choice === "required") {
            aiSdkToolChoice = "required"
          } else if (tool_choice.type === "function") {
            aiSdkToolChoice = {
              type: "tool",
              toolName: tool_choice.function.name,
            }
          }

          return { tools: aiSdkTools, toolChoice: aiSdkToolChoice }
        }

        function transformMessages() {
          const { messages } = body
          const prompt: LanguageModelV2Prompt = []

          for (const message of messages) {
            switch (message.role) {
              case "system": {
                prompt.push({
                  role: "system",
                  content: message.content as string,
                })
                break
              }

              case "user": {
                if (typeof message.content === "string") {
                  prompt.push({
                    role: "user",
                    content: [{ type: "text", text: message.content }],
                  })
                } else {
                  const content = message.content.map((part) => {
                    switch (part.type) {
                      case "text":
                        return { type: "text" as const, text: part.text }
                      case "image_url":
                        return {
                          type: "file" as const,
                          mediaType: "image/jpeg" as const,
                          data: part.image_url.url,
                        }
                      default:
                        throw new Error(`Unsupported content part type: ${(part as any).type}`)
                    }
                  })
                  prompt.push({
                    role: "user",
                    content,
                  })
                }
                break
              }

              case "assistant": {
                const content: Array<
                  | { type: "text"; text: string }
                  | {
                      type: "tool-call"
                      toolCallId: string
                      toolName: string
                      input: any
                    }
                > = []

                if (message.content) {
                  content.push({
                    type: "text",
                    text: message.content as string,
                  })
                }

                if (message.tool_calls) {
                  for (const toolCall of message.tool_calls) {
                    content.push({
                      type: "tool-call",
                      toolCallId: toolCall.id,
                      toolName: toolCall.function.name,
                      input: JSON.parse(toolCall.function.arguments),
                    })
                  }
                }

                prompt.push({
                  role: "assistant",
                  content,
                })
                break
              }

              case "tool": {
                prompt.push({
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolName: "placeholder",
                      toolCallId: message.tool_call_id,
                      output: {
                        type: "text",
                        value: message.content as string,
                      },
                    },
                  ],
                })
                break
              }

              default: {
                throw new Error(`Unsupported message role: ${message.role}`)
              }
            }
          }

          return prompt
        }
      }
    } catch (error: any) {
      return c.json({ error: { message: error.message } }, 500)
    }
  })
  .all("*", (c) => c.text("Not Found"))
