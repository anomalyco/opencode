import { encodingForModel } from "js-tiktoken"
import type { KiroPayload } from "./converters"

// Claude tokenizes ~15% more than GPT-4 (cl100k_base).
// Empirical value from kiro-gateway, validated against context_usage from API.
const CLAUDE_CORRECTION_FACTOR = 1.15

let encoding: ReturnType<typeof encodingForModel> | undefined

function getEncoding() {
  if (!encoding) encoding = encodingForModel("gpt-4o")
  return encoding
}

export function countTokens(text: string) {
  if (!text) return 0
  return Math.round(getEncoding().encode(text).length * CLAUDE_CORRECTION_FACTOR)
}

export function estimatePayloadTokens(payload: KiroPayload) {
  const state = payload.conversationState
  let tokens = 0

  // Current message
  const msg = state.currentMessage.userInputMessage
  tokens += countTokens(msg.content)

  // Tool definitions
  if (msg.userInputMessageContext?.tools) {
    for (const tool of msg.userInputMessageContext.tools) {
      tokens += 4
      tokens += countTokens(tool.toolSpecification.name)
      tokens += countTokens(tool.toolSpecification.description)
      tokens += countTokens(JSON.stringify(tool.toolSpecification.inputSchema))
    }
  }

  // Tool results
  if (msg.userInputMessageContext?.toolResults) {
    for (const result of msg.userInputMessageContext.toolResults) {
      tokens += 4
      for (const c of result.content) tokens += countTokens(c.text)
    }
  }

  // History
  if (state.history) {
    for (const item of state.history) {
      tokens += 4
      if (item.userInputMessage) {
        tokens += countTokens(item.userInputMessage.content)
        if (item.userInputMessage.userInputMessageContext?.toolResults) {
          for (const r of item.userInputMessage.userInputMessageContext.toolResults) {
            tokens += 4
            for (const c of r.content) tokens += countTokens(c.text)
          }
        }
      }
      if (item.assistantResponseMessage) {
        tokens += countTokens(item.assistantResponseMessage.content)
        if (item.assistantResponseMessage.toolUses) {
          for (const tu of item.assistantResponseMessage.toolUses) {
            tokens += 4
            tokens += countTokens(tu.name)
            tokens += countTokens(typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input))
          }
        }
        if (item.assistantResponseMessage.reasoning?.thinking) {
          tokens += countTokens(item.assistantResponseMessage.reasoning.thinking)
        }
      }
    }
  }

  // Service tokens
  tokens += 3

  return tokens
}
