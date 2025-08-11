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

  export function message(msgs: ModelMessage[], providerID: string, modelID: string) {
    if (modelID.includes("claude")) {
      msgs = normalizeToolCallIds(msgs)
    }
    if (providerID === "anthropic" || modelID.includes("anthropic") || modelID.includes("claude")) {
      msgs = applyCaching(msgs, providerID)
    }

    return msgs
  }

  export function temperature(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes("qwen")) return 0.55
    return 0
  }

  export function topP(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes("qwen")) return 1
    return undefined
  }

  export function options(_providerID: string, modelID: string) {
    if (modelID.includes("gpt-5")) {
      return {
        reasoningEffort: "minimal",
        textVerbosity: "low",
        // reasoningSummary: "auto",
        // include: ["reasoning.encrypted_content"],
      }
    }
    // if (modelID.includes("claude")) {
    //   return {
    //     thinking: {
    //       type: "enabled",
    //       budgetTokens: 32000,
    //     },
    //   }
    // }
    // if (_providerID === "bedrock") {
    //   return {
    //     reasoningConfig: { type: "enabled", budgetTokens: 32000 },
    //   }
    // }
  }
}
