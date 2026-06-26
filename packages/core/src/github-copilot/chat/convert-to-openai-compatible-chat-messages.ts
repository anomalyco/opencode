import {
  type LanguageModelV3Prompt,
  type SharedV3ProviderOptions,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import type { OpenAICompatibleChatPrompt } from "./openai-compatible-api-types"
import { convertToBase64 } from "@ai-sdk/provider-utils"

function getOpenAIMetadata(message: { providerOptions?: SharedV3ProviderOptions }) {
  const options = message?.providerOptions
  if (!options) return {}
  return options.copilot ?? options.openaiCompatible ?? options.openai ?? {}
}

function audioFormatFromMime(mime: string): "wav" | "mp3" | null {
  switch (mime) {
    case "audio/wav":
      return "wav"
    case "audio/mp3":
    case "audio/mpeg":
      return "mp3"
    default:
      return null
  }
}

export function convertToOpenAICompatibleChatMessages(prompt: LanguageModelV3Prompt): OpenAICompatibleChatPrompt {
  const messages: OpenAICompatibleChatPrompt = []
  for (const { role, content, ...message } of prompt) {
    const metadata = getOpenAIMetadata({ ...message })
    switch (role) {
      case "system": {
        messages.push({
          role: "system",
          content: content,
          ...metadata,
        })
        break
      }

      case "user": {
        if (content.length === 1 && content[0].type === "text") {
          messages.push({
            role: "user",
            content: content[0].text,
            ...getOpenAIMetadata(content[0]),
          })
          break
        }

        messages.push({
          role: "user",
          content: content.map((part) => {
            const partMetadata = getOpenAIMetadata(part)
            switch (part.type) {
              case "text": {
                return { type: "text", text: part.text, ...partMetadata }
              }
              case "file": {
                if (part.mediaType.startsWith("image/")) {
                  const mediaType = part.mediaType === "image/*" ? "image/jpeg" : part.mediaType

                  return {
                    type: "image_url",
                    image_url: {
                      url:
                        part.data instanceof URL
                          ? part.data.toString()
                          : `data:${mediaType};base64,${convertToBase64(part.data)}`,
                    },
                    ...partMetadata,
                  }
                } else if (part.mediaType.startsWith("video/")) {
                  return {
                    type: "video_url",
                    video_url: {
                      url:
                        part.data instanceof URL
                          ? part.data.toString()
                          : `data:${part.mediaType};base64,${convertToBase64(part.data)}`,
                    },
                    ...partMetadata,
                  }
                } else if (part.mediaType.startsWith("audio/")) {
                  if (part.data instanceof URL) {
                    throw new UnsupportedFunctionalityError({
                      functionality: "audio file parts with URLs",
                    })
                  }
                  const format = audioFormatFromMime(part.mediaType)
                  if (!format) {
                    throw new UnsupportedFunctionalityError({
                      functionality: `audio media type ${part.mediaType}`,
                    })
                  }
                  return {
                    type: "input_audio",
                    input_audio: {
                      data: convertToBase64(part.data),
                      format,
                    },
                    ...partMetadata,
                  }
                } else if (part.mediaType === "application/pdf") {
                  if (part.data instanceof URL) {
                    throw new UnsupportedFunctionalityError({
                      functionality: "PDF file parts with URLs",
                    })
                  }
                  return {
                    type: "file",
                    file: {
                      filename: part.filename ?? "document.pdf",
                      file_data: `data:application/pdf;base64,${convertToBase64(part.data)}`,
                    },
                    ...partMetadata,
                  }
                } else {
                  throw new UnsupportedFunctionalityError({
                    functionality: `file part media type ${part.mediaType}`,
                  })
                }
              }
            }
          }),
          ...metadata,
        })

        break
      }

      case "assistant": {
        let text = ""
        let reasoningText: string | undefined
        let reasoningOpaque: string | undefined
        let reasoningCombined = ""
        const toolCalls: Array<{
          id: string
          type: "function"
          function: { name: string; arguments: string }
        }> = []

        for (const part of content) {
          const partMetadata = getOpenAIMetadata(part)
          // Check for reasoningOpaque on any part (may be attached to text/tool-call)
          const partOpaque = (part.providerOptions as { copilot?: { reasoningOpaque?: string } })?.copilot
            ?.reasoningOpaque
          if (partOpaque && !reasoningOpaque) {
            reasoningOpaque = partOpaque
          }

          switch (part.type) {
            case "text": {
              text += part.text
              break
            }
            case "reasoning": {
              if (part.text) {
                reasoningText = part.text
                reasoningCombined += part.text
              }
              break
            }
            case "tool-call": {
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
                ...partMetadata,
              })
              break
            }
          }
        }

        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          reasoning_text: reasoningOpaque ? reasoningText : undefined,
          reasoning_opaque: reasoningOpaque,
          ...(reasoningCombined.length > 0 && !reasoningOpaque
            ? { reasoning_content: reasoningCombined }
            : {}),
          ...metadata,
        })

        break
      }

      case "tool": {
        for (const toolResponse of content) {
          if (toolResponse.type === "tool-approval-response") {
            continue
          }
          const output = toolResponse.output

          let contentValue: string
          switch (output.type) {
            case "text":
            case "error-text":
              contentValue = output.value
              break
            case "execution-denied":
              contentValue = output.reason ?? "Tool execution denied."
              break
            case "content":
            case "json":
            case "error-json":
              contentValue = JSON.stringify(output.value)
              break
          }

          const toolResponseMetadata = getOpenAIMetadata(toolResponse)
          messages.push({
            role: "tool",
            tool_call_id: toolResponse.toolCallId,
            content: contentValue,
            ...toolResponseMetadata,
          })
        }
        break
      }

      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return messages
}
