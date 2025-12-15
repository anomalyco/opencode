import type {
  LanguageModelV2Message,
  LanguageModelV2TextPart,
  LanguageModelV2FilePart,
  LanguageModelV2ToolCallPart,
  LanguageModelV2ToolResultPart,
  LanguageModelV2ReasoningPart,
} from "@ai-sdk/provider"
import type { ContentBlock } from "@agentclientprotocol/sdk"
import { Log } from "../../util/log"

type MessagePart =
  | LanguageModelV2TextPart
  | LanguageModelV2FilePart
  | LanguageModelV2ToolCallPart
  | LanguageModelV2ToolResultPart
  | LanguageModelV2ReasoningPart

const log = Log.create({ service: "acp-converter" })

/**
 * Synthesize complete tool-call/tool-result pairs for orphaned tool calls.
 * This ensures conversation history is valid when switching providers or reloading sessions.
 */
function synthesizeCompleteToolPairs(messages: LanguageModelV2Message[]): LanguageModelV2Message[] {
  const toolCallIds = new Set<string>()
  const toolResultIds = new Set<string>()
  const orphanedToolCalls: Array<{ messageIndex: number; toolCall: LanguageModelV2ToolCallPart }> = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "tool-call") {
          toolCallIds.add(part.toolCallId)
          orphanedToolCalls.push({ messageIndex: i, toolCall: part })
        }
      }
    }

    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "tool-result") {
          toolResultIds.add(part.toolCallId)
        }
      }
    }
  }

  const orphanedIds = Array.from(toolCallIds).filter((id) => !toolResultIds.has(id))

  if (orphanedIds.length === 0) {
    return messages
  }

  log.debug("Synthesizing tool results for orphaned tool calls", {
    count: orphanedIds.length,
    toolCallIds: orphanedIds,
  })

  const result = [...messages]
  const orphanedToInsert = orphanedToolCalls
    .filter((orphaned) => orphanedIds.includes(orphaned.toolCall.toolCallId))
    .sort((a, b) => b.messageIndex - a.messageIndex)

  for (const orphaned of orphanedToInsert) {
    const syntheticResult = {
      type: "tool-result" as const,
      toolCallId: orphaned.toolCall.toolCallId,
      toolName: orphaned.toolCall.toolName,
      result: {
        output: "Tool completed by ACP provider",
        title: orphaned.toolCall.toolName,
        metadata: {},
      },
    } as any

    const insertIndex = orphaned.messageIndex + 1

    if (insertIndex < result.length && result[insertIndex].role === "tool") {
      const toolMessage = result[insertIndex]
      if (Array.isArray(toolMessage.content)) {
        toolMessage.content.push(syntheticResult)
      } else {
        result[insertIndex] = {
          role: "tool",
          content: [syntheticResult],
        }
      }
    } else {
      result.splice(insertIndex, 0, {
        role: "tool",
        content: [syntheticResult],
      })
    }
  }

  return result
}

/**
 * Convert Vercel AI SDK messages to ACP ContentBlocks
 * Note: ACP ContentBlock only supports text, image, audio, resource_link, and resource types.
 * Tool calls and results are handled differently in ACP (via session updates).
 */
export function vercelToACPMessages(messages: LanguageModelV2Message[]): ContentBlock[] {
  const completeMessages = synthesizeCompleteToolPairs(messages)
  const blocks: ContentBlock[] = []

  for (const message of completeMessages) {
    const role = message.role

    switch (role) {
      case "system":
        // ACP doesn't have explicit system messages, add as text
        blocks.push({
          type: "text",
          text: message.content,
        })
        break

      case "user":
        for (const part of message.content) {
          const block = vercelPartToACPBlock(part)
          if (block) blocks.push(block)
        }
        break

      case "assistant":
        for (const part of message.content) {
          const block = vercelPartToACPBlock(part)
          if (block) blocks.push(block)
        }
        break

      case "tool":
        for (const part of message.content) {
          if (part.type === "tool-result") {
            const output =
              "result" in part && typeof part.result === "object" && part.result !== null && "output" in part.result
                ? typeof part.result.output === "string"
                  ? part.result.output
                  : JSON.stringify(part.result.output)
                : "output" in part
                  ? typeof part.output === "string"
                    ? part.output
                    : JSON.stringify(part.output)
                  : "Tool completed"
            blocks.push({
              type: "text",
              text: `Tool: ${part.toolName}\nOutput:\n${output}`,
            })
          }
        }
        break
    }
  }

  return blocks
}

/**
 * Convert a single Vercel AI SDK message part to ACP ContentBlock
 * Returns null for parts that can't be converted to ACP ContentBlocks
 */
function vercelPartToACPBlock(part: MessagePart): ContentBlock | null {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
      }

    case "file":
      // Handle file parts - convert to image if it's an image type
      if (part.mediaType?.startsWith("image/")) {
        // FilePart has data as string (base64), Uint8Array, or URL
        const data = typeof part.data === "string" ? part.data : ""
        return {
          type: "image",
          data,
          mimeType: part.mediaType,
        }
      }
      // Non-image files can't be represented as ACP ContentBlock
      return null

    case "reasoning":
      // Convert reasoning to text
      return {
        type: "text",
        text: part.text,
      }

    case "tool-call":
      // Tool calls are not part of ACP ContentBlock - they're handled via session updates
      return null

    case "tool-result":
      // Tool results are not part of ACP ContentBlock - they're handled via session updates
      return null

    default:
      return null
  }
}

/**
 * Convert ACP ContentBlocks back to Vercel AI SDK messages
 * This is primarily for reconstructing context from ACP responses
 */
export function acpToVercelMessages(blocks: ContentBlock[]): LanguageModelV2Message[] {
  const messages: LanguageModelV2Message[] = []
  const currentParts: Array<LanguageModelV2TextPart | LanguageModelV2FilePart> = []

  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        currentParts.push({ type: "text", text: block.text })
        break
      }

      case "image": {
        currentParts.push({
          type: "file",
          data: block.data,
          mediaType: block.mimeType,
        })
        break
      }

      // resource_link and resource types don't have direct mappings
      // Skip them for now
    }
  }

  // Create a single assistant message with all parts
  if (currentParts.length > 0) {
    messages.push({
      role: "assistant",
      content: currentParts as Array<LanguageModelV2TextPart | LanguageModelV2FilePart>,
    })
  }

  return messages
}
