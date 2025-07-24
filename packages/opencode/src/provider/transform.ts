import type { ModelMessage } from "ai"
import { unique } from "remeda"

export namespace ProviderTransform {
  export function message(msgs: ModelMessage[], providerID: string, modelID: string) {
    if (providerID === "anthropic" || modelID.includes("anthropic") || modelID.includes("claude")) {
      const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
      const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

      for (const msg of unique([...system, ...final])) {
        msg.providerOptions = {
          ...msg.providerOptions,
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
      }
    }
    return msgs
  }
}
