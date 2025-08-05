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

  function isHarmonyModel(modelID: string): boolean {
    return modelID.includes("gpt-oss") || modelID.includes("harmony")
  }

  function harmonyMessage(msgs: ModelMessage[], modelID: string): ModelMessage[] {
    if (!isHarmonyModel(modelID)) {
      return msgs
    }

    // Add Harmony-specific message formatting
    return msgs.map(msg => {
      if (msg.role === "system") {
        // Ensure system messages include Harmony formatting instructions
        let systemContent = ""
        if (typeof msg.content === "string") {
          systemContent = msg.content
        } else if (Array.isArray(msg.content)) {
          systemContent = (msg.content as any[]).map((p: any) => 'text' in p ? p.text : '').join('')
        }
        
        // Add Harmony instructions if not already present
        if (!systemContent.includes("<|channel|>") && !systemContent.includes("harmony")) {
          const harmonyInstructions = "\n\nUse the Harmony template format for your responses. Structure your output using:\n<|channel|>analysis<|message|>your analysis<|end|>\n<|channel|>final<|message|>your final response<|end|>"
          
          return {
            ...msg,
            content: systemContent + harmonyInstructions
          }
        }
      }
      return msg
    })
  }

  export function message(msgs: ModelMessage[], providerID: string, modelID: string) {
    if (modelID.includes("claude")) {
      msgs = normalizeToolCallIds(msgs)
    }
    if (providerID === "anthropic" || modelID.includes("anthropic") || modelID.includes("claude")) {
      msgs = applyCaching(msgs, providerID)
    }
    if (isHarmonyModel(modelID)) {
      msgs = harmonyMessage(msgs, modelID)
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
}
