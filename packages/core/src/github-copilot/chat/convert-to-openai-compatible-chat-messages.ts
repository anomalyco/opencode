import {
  type LanguageModelV3Prompt,
  type SharedV3ProviderOptions,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider"
import type { OpenAICompatibleChatPrompt } from "./openai-compatible-api-types"
import { convertToBase64 } from "@ai-sdk/provider-utils"

function getOpenAIMetadata(message: { providerOptions?: SharedV3ProviderOptions }) {
  return message?.providerOptions?.copilot ?? {}
}

function mediaData(data: unknown): data is string | Uint8Array | URL {
  return typeof data === "string" || data instanceof Uint8Array || data instanceof URL
}

function extractBase64(data: string): string {
  // Recursively strip all data URL prefixes to get pure base64
  const comma = data.indexOf(",")
  if (comma === -1) return data
  const body = data.slice(comma + 1)
  if (!body.startsWith("data:")) return body
  return extractBase64(body)
}

function normalizeDataUrl(data: string, mediaType: string): string {
  const type = mediaType === "image/*" ? "image/jpeg" : mediaType
  // If already a complete data URL, extract and rebuild
  if (data.startsWith("data:")) {
    const base64 = extractBase64(data)
    return `data:${type};base64,${base64}`
  }
  // If pure base64, add prefix
  return `data:${type};base64,${data}`
}

function dataUrl(data: string | Uint8Array | URL, mediaType: string) {
  if (data instanceof URL) return data.toString()
  if (typeof data === "string") return normalizeDataUrl(data, mediaType)
  const type = mediaType === "image/*" ? "image/jpeg" : mediaType
  return `data:${type};base64,${convertToBase64(data)}`
}

function toolMedia(output: { type: string; value: unknown }) {
  if (output.type !== "content") return []
  if (!Array.isArray(output.value)) return []
  return output.value.flatMap((part) => {
    if (!part || typeof part !== "object") return []
    if (!("type" in part) || part.type !== "media") return []
    if (!("mediaType" in part) || typeof part.mediaType !== "string") return []
    if (!("data" in part)) return []
    if (!mediaData(part.data)) return []
    if (!part.mediaType.startsWith("image/")) return []
    const type = part.mediaType === "image/*" ? "image/jpeg" : part.mediaType
    return [
      {
        type: "image_url" as const,
        image_url: {
          url: dataUrl(part.data, type),
        },
      },
    ]
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
                      url: part.data instanceof URL ? part.data.toString() : dataUrl(part.data, mediaType),
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
              if (part.text) reasoningText = part.text
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
          ...metadata,
        })

        break
      }

      case "tool": {
        for (const toolResponse of content) {
          if (toolResponse.type === "tool-approval-response") {
            continue
          }
          const output = toolResponse.output as { type: string; value: unknown }

          const contentValue = toolText(output)
          const media = toolMedia(output)

          const toolResponseMetadata = getOpenAIMetadata(toolResponse)
          messages.push({
            role: "tool",
            tool_call_id: toolResponse.toolCallId,
            content: contentValue,
            ...toolResponseMetadata,
          })

          if (media.length > 0) {
            messages.push({
              role: "user",
              content: [{ type: "text", text: "Attached image(s) from tool result:" }, ...media],
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

  return messages
}
