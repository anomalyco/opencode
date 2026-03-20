import { encodingForModel } from "js-tiktoken"
import type { KiroPayload } from "./converters"

let encoding: ReturnType<typeof encodingForModel> | undefined

function getEncoding() {
  if (!encoding) encoding = encodingForModel("gpt-4o")
  return encoding
}

// Raw GPT-4o token count — no correction factor applied.
// Correction is applied at the payload level in estimatePayloadTokens.
export function countTokens(text: string) {
  if (!text) return 0
  return getEncoding().encode(text).length
}

// Empirical constants derived from binary-search boundary tests against the Kiro API.
// The server rejected payloads at these exact byte thresholds:
//   0 tools → 812,219 bytes   10 tools → 808,395 bytes
// Server limit ≈ 200K tokens (server-side tokenizer, not publicly available).
//
// Tool overhead (server-side) is non-linear:
//   1 tool: 531 server tokens for 54 raw tokens (9.8x)
//   10 tools: 2,443 server tokens for 540 raw tokens (4.5x)
// Model: TOOL_FIXED_OVERHEAD + TOOL_PER_OVERHEAD * rawToolTokens
const TOOL_FIXED_OVERHEAD = 350
const TOOL_PER_MULTIPLIER = 3.5

// The server tokenizer differs from gpt-4o by content type:
//   prose/JSON: ~1.0x   code: ~1.2-1.3x   mixed: ~1.1x
// We use 1.10 as a conservative baseline (most payloads are mixed code+prose)
// plus a 5% safety margin to avoid hitting the server limit.
const TEXT_CORRECTION = 1.10
const SAFETY_MARGIN = 1.05

// Per-message framing overhead (role markers, separators, JSON structure).
// Anthropic adds ~4 tokens per message for role/turn markers.
const MSG_OVERHEAD = 4

export function estimatePayloadTokens(payload: KiroPayload) {
  const state = payload.conversationState
  let tokens = 0
  let toolDefTokens = 0

  // Current message
  const msg = state.currentMessage.userInputMessage
  tokens += countTokens(msg.content)

  // Tool definitions — counted separately with higher multiplier
  if (msg.userInputMessageContext?.tools) {
    for (const tool of msg.userInputMessageContext.tools) {
      toolDefTokens += countTokens(tool.toolSpecification.name)
      toolDefTokens += countTokens(tool.toolSpecification.description)
      toolDefTokens += countTokens(JSON.stringify(tool.toolSpecification.inputSchema))
    }
  }

  // Tool results
  if (msg.userInputMessageContext?.toolResults) {
    for (const result of msg.userInputMessageContext.toolResults) {
      tokens += MSG_OVERHEAD
      for (const c of result.content) tokens += countTokens(c.text)
    }
  }

  // History
  if (state.history) {
    for (const item of state.history) {
      tokens += MSG_OVERHEAD
      if (item.userInputMessage) {
        tokens += countTokens(item.userInputMessage.content)
        if (item.userInputMessage.userInputMessageContext?.toolResults) {
          for (const r of item.userInputMessage.userInputMessageContext.toolResults) {
            tokens += MSG_OVERHEAD
            for (const c of r.content) tokens += countTokens(c.text)
          }
        }
      }
      if (item.assistantResponseMessage) {
        tokens += countTokens(item.assistantResponseMessage.content)
        if (item.assistantResponseMessage.toolUses) {
          for (const tu of item.assistantResponseMessage.toolUses) {
            tokens += MSG_OVERHEAD
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

  // Apply text correction (gpt-4o → server tokenizer approximation)
  tokens = Math.round(tokens * TEXT_CORRECTION)

  // Add tool definition overhead (empirical: fixed + multiplier * raw tokens)
  if (toolDefTokens > 0) {
    tokens += TOOL_FIXED_OVERHEAD + Math.round(toolDefTokens * TOOL_PER_MULTIPLIER)
  }

  // Service/framing tokens + safety margin
  tokens += 3
  return Math.round(tokens * SAFETY_MARGIN)
}
