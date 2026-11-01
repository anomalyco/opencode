export * as ConvertClaudeStream from "./convert-claude-stream.js"

import type { LanguageModelV3FunctionTool, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { Provider } from "@opencode/schema/provider"
import { ClaudeUsage } from "./usage.js"
import { ToolNames } from "../tools/names.js"
import { ClaudeAgentError } from "./claude-agent-error.js"

export function make(tools: readonly LanguageModelV3FunctionTool[]) {
  const usage = ClaudeUsage.make()
  const failure = ClaudeAgentError.make()
  const streamed = new Set<string>()
  const blocks = new Map<number, "text" | "reasoning">()
  let messageID = ""
  let calledTools = false
  let metadata: Record<string, { sessionID: string; messageID: string }> | undefined

  return (message: SDKMessage): LanguageModelV3StreamPart[] => {
    const parts: LanguageModelV3StreamPart[] = []
    const error = failure(message)
    if (error) return [{ type: "error", error }]
    if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      const event = message.event
      switch (event.type) {
        case "message_start":
          messageID = event.message.id
          metadata = undefined
          streamed.add(messageID)
          usage.update(messageID, event.message.usage)
          parts.push({ type: "response-metadata", id: messageID, modelId: event.message.model })
          break
        case "content_block_start": {
          const block = event.content_block
          const id = `${messageID}:${event.index}`
          if (block.type === "text") {
            blocks.set(event.index, "text")
            parts.push({ type: "text-start", id })
            if (block.text) parts.push({ type: "text-delta", id, delta: block.text })
            break
          }
          if (block.type === "thinking") {
            blocks.set(event.index, "reasoning")
            parts.push({ type: "reasoning-start", id })
            if (block.thinking) parts.push({ type: "reasoning-delta", id, delta: block.thinking })
          }
          break
        }
        case "content_block_delta": {
          const id = `${messageID}:${event.index}`
          const delta = event.delta
          if (delta.type === "text_delta") {
            parts.push({ type: "text-delta", id, delta: delta.text })
            break
          }
          if (delta.type === "thinking_delta" && delta.thinking) {
            parts.push({ type: "reasoning-delta", id, delta: delta.thinking })
          }
          break
        }
        case "content_block_stop": {
          const kind = blocks.get(event.index)
          if (kind) parts.push({ type: `${kind}-end`, id: `${messageID}:${event.index}`, providerMetadata: metadata })
          blocks.delete(event.index)
          break
        }
        case "message_delta":
          usage.update(messageID, event.usage)
          break
        case "message_stop":
          // Must match ClaudeSession.readStep's tool boundary, or OpenCode's step ends without a finish event.
          if (calledTools) {
            parts.push({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_use" },
              usage: usage.snapshot(),
            })
          }
          break
      }
    }
    if (message.type === "assistant" && message.parent_tool_use_id === null) {
      // Synthetic API errors are diagnostics, not assistant answers.
      if (message.error) return parts
      // Stream events carry API message IDs; only the complete assistant message carries the transcript UUID.
      metadata = { [Provider.ID.claudeAgent]: { sessionID: message.session_id, messageID: message.uuid } }
      usage.update(message.message.id, message.message.usage)
      for (const block of message.message.content) {
        if (block.type !== "tool_use") continue
        const toolName = ToolNames.original(block.name, tools)
        if (!toolName) continue
        calledTools = true
        parts.push({
          type: "tool-call",
          toolCallId: block.id,
          toolName,
          input: JSON.stringify(block.input),
          providerMetadata: metadata,
        })
      }
      // Complete assistant messages repeat the streamed content. Only use them when nothing was streamed.
      if (!streamed.has(message.message.id)) {
        for (let i = 0; i < message.message.content.length; i++) {
          const block = message.message.content[i]!
          const id = `${message.uuid}:${i}`
          if (block.type === "text") {
            parts.push({ type: "text-start", id })
            parts.push({ type: "text-delta", id, delta: block.text })
            parts.push({ type: "text-end", id, providerMetadata: metadata })
            continue
          }
          if (block.type === "thinking") {
            parts.push({ type: "reasoning-start", id })
            parts.push({ type: "reasoning-delta", id, delta: block.thinking })
            parts.push({ type: "reasoning-end", id })
          }
        }
      }
    }
    if (message.type === "result") {
      if (message.num_turns === 1) usage.result(message.usage)
      parts.push({
        type: "finish",
        finishReason: {
          unified: message.stop_reason === "max_tokens" ? "length" : "stop",
          raw: message.stop_reason ?? undefined,
        },
        usage: usage.snapshot(),
      })
    }
    return parts
  }
}
