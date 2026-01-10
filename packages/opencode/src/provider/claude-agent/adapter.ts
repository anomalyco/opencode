import { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@/id/id"
import type { MessageContext } from "./types"
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk"

/**
 * Adapter for translating between opencode MessageV2 format and Claude Agent SDK format
 */
export namespace ClaudeAgentAdapter {
  /**
   * Extract the user prompt from opencode messages for SDK input
   */
  export function toSDKPrompt(messages: MessageV2.WithParts[]): string {
    // Find the last user message and extract text parts
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info.role === "user") {
        const textParts = msg.parts
          .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
          .map((p) => p.text)
        if (textParts.length > 0) {
          return textParts.join("\n")
        }
      }
    }
    return ""
  }

  /**
   * Convert SDK message to opencode Part
   * Based on SDK message types from @anthropic-ai/claude-agent-sdk
   */
  export function fromSDKMessage(
    sdkMsg: SDKMessage,
    ctx: MessageContext,
  ): MessageV2.Part | MessageV2.Part[] | null {
    switch (sdkMsg.type) {
      case "assistant":
        return fromAssistantMessage(sdkMsg, ctx)
      case "result":
        return fromResultMessage(sdkMsg, ctx)
      case "system":
        // System messages (init) are metadata, not displayed
        return null
      case "user":
        // User messages are from resume/replay, skip
        return null
      case "stream_event":
        // Partial messages for streaming - handled separately
        return null
      default:
        return null
    }
  }

  function fromAssistantMessage(msg: SDKAssistantMessage, ctx: MessageContext): MessageV2.Part[] {
    const parts: MessageV2.Part[] = []
    const content = msg.message?.content

    if (!content) return parts

    for (const block of content) {
      if ("text" in block && block.text) {
        parts.push({
          id: Identifier.ascending("part"),
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          type: "text",
          text: block.text,
        })
      } else if ("name" in block && block.type === "tool_use") {
        // Tool use block - SDK is calling a tool
        parts.push({
          id: Identifier.ascending("part"),
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          type: "tool",
          tool: block.name,
          callID: block.id,
          state: {
            status: "running",
            input: block.input as Record<string, unknown>,
            time: { start: Date.now() },
          },
        })
      } else if (block.type === "thinking" && "thinking" in block) {
        // Extended thinking/reasoning
        parts.push({
          id: Identifier.ascending("part"),
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          type: "reasoning",
          text: block.thinking as string,
          time: { start: Date.now() },
        })
      }
    }

    return parts
  }

  function fromResultMessage(msg: SDKResultMessage, ctx: MessageContext): MessageV2.Part | null {
    // Result message contains the final text which is already included in assistant messages
    // Returning null to avoid duplicate output
    // Usage/cost info is extracted separately in extractUsage()
    return null
  }

  /**
   * Create a tool completion part from SDK tool result
   */
  export function toolCompleted(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    output: string,
    ctx: MessageContext,
  ): MessageV2.ToolPart {
    return {
      id: Identifier.ascending("part"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      type: "tool",
      tool: toolName,
      callID: toolCallId,
      state: {
        status: "completed",
        input,
        output,
        title: toolName,
        metadata: {},
        time: { start: Date.now(), end: Date.now() },
      },
    }
  }

  /**
   * Create a tool error part from SDK tool failure
   */
  export function toolError(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    error: string,
    ctx: MessageContext,
  ): MessageV2.ToolPart {
    return {
      id: Identifier.ascending("part"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      type: "tool",
      tool: toolName,
      callID: toolCallId,
      state: {
        status: "error",
        input,
        error,
        time: { start: Date.now(), end: Date.now() },
      },
    }
  }

  /**
   * Extract usage statistics from SDK result message
   */
  export function extractUsage(msg: SDKResultMessage): {
    input: number
    output: number
    cache: { read: number; write: number }
    cost: number
  } {
    const usage = msg.usage || { input_tokens: 0, output_tokens: 0 }
    return {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cache: {
        read: usage.cache_read_input_tokens || 0,
        write: usage.cache_creation_input_tokens || 0,
      },
      cost: msg.total_cost_usd || 0,
    }
  }
}

