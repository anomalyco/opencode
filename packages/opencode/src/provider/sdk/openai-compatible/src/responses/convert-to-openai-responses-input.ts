import {
  type LanguageModelV2CallWarning,
  type LanguageModelV2Prompt,
  type LanguageModelV2ToolCallPart,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import { convertToBase64, parseProviderOptions, zodSchema } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"
import type { OpenAIResponsesInput, OpenAIResponsesReasoning } from "./openai-responses-api-types"
import { localShellInputSchema, localShellOutputSchema } from "./tool/local-shell"

/**
 * Check if a string is a file ID based on the given prefixes
 * Returns false if prefixes is undefined (disables file ID detection)
 */
function isFileId(data: string, prefixes?: readonly string[]): boolean {
  if (!prefixes) return false
  return prefixes.some((prefix) => data.startsWith(prefix))
}

function extractBase64(data: string): string {
  // Recursively strip all data URL prefixes to get pure base64
  const comma = data.indexOf(",")
  if (comma === -1) return data
  const body = data.slice(comma + 1)
  if (!body.startsWith("data:")) return body
  return extractBase64(body)
}

function dataUrl(data: string, mediaType: string) {
  const type = mediaType === "image/*" ? "image/jpeg" : mediaType
  // If already a complete data URL, extract and rebuild
  if (data.startsWith("data:")) {
    const base64 = extractBase64(data)
    return `data:${type};base64,${base64}`
  }
  // If pure base64, add prefix
  return `data:${type};base64,${data}`
}

function imageUrl(data: string | Uint8Array | URL, mediaType: string) {
  if (data instanceof URL) return data.toString()
  if (typeof data === "string") {
    if (isFileId(data)) return data
    return dataUrl(data, mediaType)
  }
  const type = mediaType === "image/*" ? "image/jpeg" : mediaType
  return `data:${type};base64,${convertToBase64(data)}`
}

function image(data: string, mediaType: string) {
  return {
    type: "input_image" as const,
    image_url: dataUrl(data, mediaType),
  }
}

function toolMedia(output: { type: string; value: unknown }) {
  if (output.type !== "content") return []
  if (!Array.isArray(output.value)) return []
  return output.value.flatMap((part) => {
    if (!part || typeof part !== "object") return []
    if (!("type" in part) || part.type !== "media") return []
    if (!("mediaType" in part) || typeof part.mediaType !== "string") return []
    if (!("data" in part) || typeof part.data !== "string") return []
    if (!part.mediaType.startsWith("image/")) return []
    return [image(part.data, part.mediaType)]
  })
}

function toolText(output: { type: string; value: unknown }) {
  switch (output.type) {
    case "text":
    case "error-text":
      return typeof output.value === "string" ? output.value : JSON.stringify(output.value)
    case "content":
      if (!Array.isArray(output.value)) return JSON.stringify(output.value)
      return output.value
        .flatMap((part) => {
          if (!part || typeof part !== "object") return []
          if (!("type" in part) || part.type !== "text") return []
          if (!("text" in part) || typeof part.text !== "string") return []
          return [part.text]
        })
        .join("\n\n")
    case "json":
    case "error-json":
      return JSON.stringify(output.value)
  }

  return JSON.stringify(output.value)
}

export async function convertToOpenAIResponsesInput({
  prompt,
  systemMessageMode,
  fileIdPrefixes,
  store,
  hasLocalShellTool = false,
}: {
  prompt: LanguageModelV2Prompt
  systemMessageMode: "system" | "developer" | "remove"
  fileIdPrefixes?: readonly string[]
  store: boolean
  hasLocalShellTool?: boolean
}): Promise<{
  input: OpenAIResponsesInput
  warnings: Array<LanguageModelV2CallWarning>
}> {
  const input: OpenAIResponsesInput = []
  const warnings: Array<LanguageModelV2CallWarning> = []

  for (const { role, content } of prompt) {
    switch (role) {
      case "system": {
        switch (systemMessageMode) {
          case "system": {
            input.push({ role: "system", content })
            break
          }
          case "developer": {
            input.push({ role: "developer", content })
            break
          }
          case "remove": {
            warnings.push({
              type: "other",
              message: "system messages are removed for this model",
            })
            break
          }
          default: {
            const _exhaustiveCheck: never = systemMessageMode
            throw new Error(`Unsupported system message mode: ${_exhaustiveCheck}`)
          }
        }
        break
      }

      case "user": {
        input.push({
          role: "user",
          content: content.map((part, index) => {
            switch (part.type) {
              case "text": {
                return { type: "input_text", text: part.text }
              }
              case "file": {
                if (part.mediaType.startsWith("image/")) {
                  const mediaType = part.mediaType === "image/*" ? "image/jpeg" : part.mediaType

                  return {
                    type: "input_image",
                    ...(part.data instanceof URL
                      ? { image_url: part.data.toString() }
                      : typeof part.data === "string" && isFileId(part.data, fileIdPrefixes)
                        ? { file_id: part.data }
                        : { image_url: imageUrl(part.data, mediaType) }),
                    detail: part.providerOptions?.openai?.imageDetail,
                  }
                } else if (part.mediaType === "application/pdf") {
                  if (part.data instanceof URL) {
                    return {
                      type: "input_file",
                      file_url: part.data.toString(),
                    }
                  }
                  return {
                    type: "input_file",
                    ...(typeof part.data === "string" && isFileId(part.data, fileIdPrefixes)
                      ? { file_id: part.data }
                      : {
                          filename: part.filename ?? `part-${index}.pdf`,
                          file_data: `data:application/pdf;base64,${convertToBase64(part.data)}`,
                        }),
                  }
                } else {
                  throw new UnsupportedFunctionalityError({
                    functionality: `file part media type ${part.mediaType}`,
                  })
                }
              }
            }
          }),
        })

        break
      }

      case "assistant": {
        const reasoningMessages: Record<string, OpenAIResponsesReasoning> = {}
        const toolCallParts: Record<string, LanguageModelV2ToolCallPart> = {}

        for (const part of content) {
          switch (part.type) {
            case "text": {
              input.push({
                role: "assistant",
                content: [{ type: "output_text", text: part.text }],
                id: (part.providerOptions?.openai?.itemId as string) ?? undefined,
              })
              break
            }
            case "tool-call": {
              toolCallParts[part.toolCallId] = part

              if (part.providerExecuted) {
                break
              }

              if (hasLocalShellTool && part.toolName === "local_shell") {
                const parsedInput = localShellInputSchema.parse(part.input)
                input.push({
                  type: "local_shell_call",
                  call_id: part.toolCallId,
                  id: (part.providerOptions?.openai?.itemId as string) ?? undefined,
                  action: {
                    type: "exec",
                    command: parsedInput.action.command,
                    timeout_ms: parsedInput.action.timeoutMs,
                    user: parsedInput.action.user,
                    working_directory: parsedInput.action.workingDirectory,
                    env: parsedInput.action.env,
                  },
                })

                break
              }

              input.push({
                type: "function_call",
                call_id: part.toolCallId,
                name: part.toolName,
                arguments: JSON.stringify(part.input),
                id: (part.providerOptions?.openai?.itemId as string) ?? undefined,
              })
              break
            }

            // assistant tool result parts are from provider-executed tools:
            case "tool-result": {
              if (store) {
                // use item references to refer to tool results from built-in tools
                input.push({ type: "item_reference", id: part.toolCallId })
              } else {
                warnings.push({
                  type: "other",
                  message: `Results for OpenAI tool ${part.toolName} are not sent to the API when store is false`,
                })
              }

              break
            }

            case "reasoning": {
              const providerOptions = (await parseProviderOptions({
                provider: "openai",
                providerOptions: part.providerOptions,
                schema: (zodSchema as any)(openaiResponsesReasoningProviderOptionsSchema),
              })) as OpenAIResponsesReasoningProviderOptions | undefined

              const reasoningId = providerOptions?.itemId

              if (reasoningId != null) {
                const reasoningMessage = reasoningMessages[reasoningId]

                if (store) {
                  if (reasoningMessage === undefined) {
                    // use item references to refer to reasoning (single reference)
                    input.push({ type: "item_reference", id: reasoningId })

                    // store unused reasoning message to mark id as used
                    reasoningMessages[reasoningId] = {
                      type: "reasoning",
                      id: reasoningId,
                      summary: [],
                    }
                  }
                } else {
                  const summaryParts: Array<{
                    type: "summary_text"
                    text: string
                  }> = []

                  if (part.text.length > 0) {
                    summaryParts.push({
                      type: "summary_text",
                      text: part.text,
                    })
                  } else if (reasoningMessage !== undefined) {
                    warnings.push({
                      type: "other",
                      message: `Cannot append empty reasoning part to existing reasoning sequence. Skipping reasoning part: ${JSON.stringify(part)}.`,
                    })
                  }

                  if (reasoningMessage === undefined) {
                    reasoningMessages[reasoningId] = {
                      type: "reasoning",
                      id: reasoningId,
                      encrypted_content: providerOptions?.reasoningEncryptedContent,
                      summary: summaryParts,
                    }
                    input.push(reasoningMessages[reasoningId])
                  } else {
                    reasoningMessage.summary.push(...summaryParts)
                  }
                }
              } else {
                warnings.push({
                  type: "other",
                  message: `Non-OpenAI reasoning parts are not supported. Skipping reasoning part: ${JSON.stringify(part)}.`,
                })
              }
              break
            }
          }
        }

        break
      }

      case "tool": {
        for (const part of content) {
          const output = part.output

          if (hasLocalShellTool && part.toolName === "local_shell" && output.type === "json") {
            input.push({
              type: "local_shell_call_output",
              call_id: part.toolCallId,
              output: localShellOutputSchema.parse(output.value).output,
            })
            break
          }

          const contentValue = toolText(output)

          input.push({
            type: "function_call_output",
            call_id: part.toolCallId,
            output: contentValue,
          })

          const media = toolMedia(output)
          if (media.length > 0) {
            input.push({
              role: "user",
              content: [{ type: "input_text", text: "Attached image(s) from tool result:" }, ...media],
            })
          }
        }

        break
      }

      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return { input, warnings }
}

const openaiResponsesReasoningProviderOptionsSchema = z.object({
  itemId: z.string().nullish(),
  reasoningEncryptedContent: z.string().nullish(),
})

export type OpenAIResponsesReasoningProviderOptions = z.infer<typeof openaiResponsesReasoningProviderOptionsSchema>
