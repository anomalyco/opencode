import { UnsupportedFunctionalityError, type LanguageModelV2Prompt } from "@ai-sdk/provider"
import { parseProviderOptions } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"

export const copilotChatProviderOptionsSchema = z.object({
  reasoning_opaque: z.string().nullish(),
  reasoning_text: z.string().nullish(),
})

export type CopilotChatProviderOptions = z.infer<typeof copilotChatProviderOptionsSchema>

type CopilotChatToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

type CopilotChatMessage =
  | {
      role: "system" | "user"
      content: string
    }
  | {
      role: "assistant"
      content: string | null
      tool_calls?: CopilotChatToolCall[]
      reasoning_opaque?: string | null
      reasoning_text?: string | null
    }
  | {
      role: "tool"
      tool_call_id: string
      content: string
    }

function toArgument(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function toToolOutput(output: { type: string; value: unknown }): string {
  if (output.type === "text" || output.type === "error-text") {
    return String(output.value)
  }

  if (output.type === "content" || output.type === "json" || output.type === "error-json") {
    return JSON.stringify(output.value)
  }

  throw new UnsupportedFunctionalityError({
    functionality: `tool output type ${output.type}`,
  })
}

function toParts(content: unknown): Array<{ type: string; [key: string]: unknown }> {
  if (typeof content === "string") return [{ type: "text", text: content }]
  if (Array.isArray(content)) return content
  return []
}

export async function convertToCopilotChatMessages(
  messages: LanguageModelV2Prompt,
  providerOptions?: Record<string, unknown>,
): Promise<CopilotChatMessage[]> {
  const base = await parseProviderOptions({
    provider: "openaiCompatible",
    providerOptions,
    schema: copilotChatProviderOptionsSchema,
  })

  const output: CopilotChatMessage[] = []

  for (const message of messages) {
    if (message.role === "system" || message.role === "user") {
      const parts = toParts(message.content)
      const texts = parts.filter((part) => part.type === "text")

      if (texts.length === 0 && parts.length > 0) {
        throw new UnsupportedFunctionalityError({
          functionality: `message part type for ${message.role}`,
        })
      }

      output.push({
        role: message.role,
        content: texts.map((part) => String(part.text ?? "")).join(""),
      })
      continue
    }

    if (message.role === "assistant") {
      const parts = toParts(message.content)
      const calls: CopilotChatToolCall[] = []
      const texts: string[] = []

      for (const part of parts) {
        if (part.type === "text") {
          texts.push(String(part.text ?? ""))
          continue
        }

        if (part.type === "tool-call") {
          if (part.providerExecuted) continue
          calls.push({
            id: String(part.toolCallId ?? ""),
            type: "function",
            function: {
              name: String(part.toolName ?? ""),
              arguments: toArgument(part.input),
            },
          })
          continue
        }

        throw new UnsupportedFunctionalityError({
          functionality: `assistant message part type ${part.type}`,
        })
      }

      const options = await parseProviderOptions({
        provider: "openaiCompatible",
        providerOptions: message.providerOptions ?? providerOptions,
        schema: copilotChatProviderOptionsSchema,
      })

      const opaque = options?.reasoning_opaque ?? base?.reasoning_opaque
      const reasoning = options?.reasoning_text ?? base?.reasoning_text

      const next: CopilotChatMessage = {
        role: "assistant",
        content: texts.length > 0 ? texts.join("") : null,
      }

      if (calls.length > 0) {
        next.tool_calls = calls
      }

      if (opaque != null) {
        next.reasoning_opaque = opaque
      }

      if (reasoning != null) {
        next.reasoning_text = reasoning
      }

      output.push(next)
      continue
    }

    if (message.role === "tool") {
      if (typeof message.content === "string") {
        const call = "toolCallId" in message ? message.toolCallId : undefined
        if (typeof call !== "string") {
          throw new UnsupportedFunctionalityError({
            functionality: "tool message without tool_call_id",
          })
        }
        output.push({ role: "tool", tool_call_id: call, content: message.content })
        continue
      }

      if (!Array.isArray(message.content)) {
        throw new UnsupportedFunctionalityError({
          functionality: "tool message content",
        })
      }

      for (const part of message.content) {
        if (part.type !== "tool-result") {
          throw new UnsupportedFunctionalityError({
            functionality: `tool message part type ${part.type}`,
          })
        }

        output.push({
          role: "tool",
          tool_call_id: String(part.toolCallId ?? ""),
          content: toToolOutput(part.output),
        })
      }

      continue
    }

    throw new Error("Unsupported role")
  }

  return output
}
