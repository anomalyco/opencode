import type { ModelMessage } from "ai"
import { unique } from "remeda"

export namespace ProviderTransform {
  function normalizeToolCallIds(msgs: ModelMessage[]): ModelMessage[] {
    return msgs.map((msg) => {
      if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
        msg.content = msg.content.map((part) => {
          if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
            return {
              ...part,
              toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
            }
          }
          return part
        })
      }
      return msg
    })
  }

  function applyCaching(msgs: ModelMessage[], providerID: string): ModelMessage[] {
    const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
    const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

    const providerOptions = {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
      openrouter: {
        cache_control: { type: "ephemeral" },
      },
      bedrock: {
        cachePoint: { type: "ephemeral" },
      },
      openaiCompatible: {
        cache_control: { type: "ephemeral" },
      },
    }

    for (const msg of unique([...system, ...final])) {
      const shouldUseContentOptions = providerID !== "anthropic" && Array.isArray(msg.content) && msg.content.length > 0

      if (shouldUseContentOptions) {
        const lastContent = msg.content[msg.content.length - 1]
        if (lastContent && typeof lastContent === "object") {
          lastContent.providerOptions = {
            ...lastContent.providerOptions,
            ...providerOptions,
          }
          continue
        }
      }

      msg.providerOptions = {
        ...msg.providerOptions,
        ...providerOptions,
      }
    }

    return msgs
  }

  function normalizeMistralToolCallIds(msgs: ModelMessage[]): ModelMessage[] {
    return msgs.map((msg) => {
      if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
        msg.content = msg.content.map((part) => {
          if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
            // Mistral requires alphanumeric tool call IDs with exactly 9 characters
            const normalizedId = part.toolCallId
              .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric characters
              .substring(0, 9) // Take first 9 characters
              .padEnd(9, "0") // Pad with zeros if less than 9 characters
            
            return {
              ...part,
              toolCallId: normalizedId,
            }
          }
          return part
        })
      }
      return msg
    })
  }

  function fixMistralMessageSequence(msgs: ModelMessage[]): ModelMessage[] {
    const result: ModelMessage[] = []
    
    for (let i = 0; i < msgs.length; i++) {
      const currentMsg = msgs[i]
      const nextMsg = msgs[i + 1]
      
      result.push(currentMsg)
      
      // Check if tool message is followed by user message (invalid for Mistral)
      if (currentMsg.role === "tool" && nextMsg?.role === "user") {
        // Insert an assistant message to process the tool result
        result.push({
          role: "assistant",
          content: "I'll continue with your request based on the tool results.",
          toolInvocations: [],
        })
      }
    }
    
    return result
  }

  export function message(msgs: ModelMessage[], providerID: string, modelID: string) {
    if (modelID.includes("claude")) {
      msgs = normalizeToolCallIds(msgs)
    }
    if (providerID === "anthropic" || modelID.includes("anthropic") || modelID.includes("claude")) {
      msgs = applyCaching(msgs, providerID)
    }
    if (modelID.toLowerCase().includes("mistral") || modelID.toLowerCase().includes("devstral")) {
      msgs = normalizeMistralToolCallIds(msgs)
      msgs = fixMistralMessageSequence(msgs)
    }

    return msgs
  }

  export function temperature(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes("qwen")) return 0.55
    if (modelID.toLowerCase().includes("claude")) return 1
    return 0
  }

  export function topP(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes("qwen")) return 1
    return undefined
  }

  export function options(providerID: string, modelID: string, sessionID: string): Record<string, any> | undefined {
    const result: Record<string, any> = {}

    if (providerID === "openai") {
      result["promptCacheKey"] = sessionID
    }

    if (modelID.includes("gpt-5") && !modelID.includes("gpt-5-chat")) {
      result["reasoningEffort"] = "high"
      if (providerID !== "azure") {
        result["textVerbosity"] = "low"
      }
    }
    return result
  }
}
