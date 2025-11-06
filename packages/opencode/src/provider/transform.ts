import type { ModelMessage } from "ai"
import { unique } from "remeda"
import type { JSONSchema } from "zod/v4/core"

export namespace ProviderTransform {
  function normalizeMessages(
    msgs: ModelMessage[],
    providerID: string,
    modelID: string,
  ): ModelMessage[] {
    if (modelID.includes("claude")) {
      return msgs.map((msg) => {
        if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
          msg.content = msg.content.map((part) => {
            if (
              (part.type === "tool-call" || part.type === "tool-result") &&
              "toolCallId" in part
            ) {
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
    if (providerID === "mistral" || modelID.toLowerCase().includes("mistral")) {
      const result: ModelMessage[] = []
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i]
        const prevMsg = msgs[i - 1]
        const nextMsg = msgs[i + 1]

        if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
          msg.content = msg.content.map((part) => {
            if (
              (part.type === "tool-call" || part.type === "tool-result") &&
              "toolCallId" in part
            ) {
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

        result.push(msg)

        // Fix message sequence: tool messages cannot be followed by user messages
        if (msg.role === "tool" && nextMsg?.role === "user") {
          result.push({
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Done.",
              },
            ],
          })
        }
      }
      return result
    }

    return msgs
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
      const shouldUseContentOptions =
        providerID !== "anthropic" && Array.isArray(msg.content) && msg.content.length > 0

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
    msgs = normalizeMessages(msgs, providerID, modelID)
    if (providerID === "anthropic" || modelID.includes("anthropic") || modelID.includes("claude")) {
      msgs = applyCaching(msgs, providerID)
    }

    return msgs
  }

  export function temperature(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes("qwen")) return 0.55
    if (modelID.toLowerCase().includes("claude")) return undefined
    return 0
  }

  export function topP(_providerID: string, modelID: string) {
    if (modelID.toLowerCase().includes("qwen")) return 1
    return undefined
  }

  export function options(
    providerID: string,
    modelID: string,
    sessionID: string,
  ): Record<string, any> | undefined {
    const result: Record<string, any> = {}

    if (providerID === "openai") {
      result["promptCacheKey"] = sessionID
    }

    if (modelID.includes("gpt-5") && !modelID.includes("gpt-5-chat")) {
      if (modelID.includes("codex")) {
        result["store"] = false
      }

      if (!modelID.includes("codex") && !modelID.includes("gpt-5-pro")) {
        result["reasoningEffort"] = "medium"
      }

      if (providerID === "opencode") {
        result["promptCacheKey"] = sessionID
        result["include"] = ["reasoning.encrypted_content"]
        result["reasoningSummary"] = "auto"
      }
    }
    return result
  }

  export function providerOptions(
    npm: string | undefined,
    providerID: string,
    options: { [x: string]: any },
  ) {
    switch (npm) {
      case "@ai-sdk/openai":
      case "@ai-sdk/azure":
        return {
          ["openai" as string]: options,
        }
      case "@ai-sdk/amazon-bedrock":
        return {
          ["bedrock" as string]: options,
        }
      case "@ai-sdk/anthropic":
        return {
          ["anthropic" as string]: options,
        }
      default:
        return {
          [providerID]: options,
        }
    }
  }

  export function maxOutputTokens(
    providerID: string,
    options: Record<string, any>,
    modelLimit: number,
    globalLimit: number,
  ): number {
    const modelCap = modelLimit || globalLimit
    const standardLimit = Math.min(modelCap, globalLimit)

    if (providerID === "anthropic") {
      const thinking = options?.["thinking"]
      const budgetTokens =
        typeof thinking?.["budgetTokens"] === "number" ? thinking["budgetTokens"] : 0
      const enabled = thinking?.["type"] === "enabled"
      if (enabled && budgetTokens > 0) {
        // Return text tokens so that text + thinking <= model cap, preferring 32k text when possible.
        if (budgetTokens + standardLimit <= modelCap) {
          return standardLimit
        }
        return modelCap - budgetTokens
      }
    }

    return standardLimit
  }

  export function schema(_providerID: string, _modelID: string, schema: JSONSchema.BaseSchema) {
    /*
    if (["openai", "azure"].includes(providerID)) {
      if (schema.type === "object" && schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          if (schema.required?.includes(key)) continue
          schema.properties[key] = {
            anyOf: [
              value as JSONSchema.JSONSchema,
              {
                type: "null",
              },
            ],
          }
        }
      }
    }

    if (providerID === "google") {
    }
    */

    return schema
  }
}
