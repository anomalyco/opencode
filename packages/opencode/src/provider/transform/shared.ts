import type { ModelMessage } from "ai"
import { mergeDeep, unique } from "remeda"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import type { Provider } from "../provider"

type Modality = NonNullable<import("../models").ModelsDev.Model["modalities"]>["input"][number]

export const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
export const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
export const ADAPTIVE_EFFORTS = ["low", "medium", "high", "max"]

const SLUG_OVERRIDES: Record<string, string> = {
  amazon: "bedrock",
}

function mimeToModality(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

export function sdkKey(npm: string): string | undefined {
  switch (npm) {
    case "@ai-sdk/github-copilot":
      return "copilot"
    case "@ai-sdk/azure":
      return "azure"
    case "@ai-sdk/openai":
      return "openai"
    case "@ai-sdk/amazon-bedrock":
      return "bedrock"
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return "anthropic"
    case "@ai-sdk/google-vertex":
      return "vertex"
    case "@ai-sdk/google":
      return "google"
    case "@ai-sdk/gateway":
      return "gateway"
    case "@openrouter/ai-sdk-provider":
      return "openrouter"
  }
  return undefined
}

export function isAnthropicAdaptive(model: Provider.Model) {
  return ["opus-4-6", "opus-4.6", "sonnet-4-6", "sonnet-4.6"].some((v) => model.api.id.includes(v))
}

export function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

    const filtered = msg.content.map((part) => {
      if (part.type !== "file" && part.type !== "image") return part

      if (part.type === "image") {
        const imageStr = part.image.toString()
        if (imageStr.startsWith("data:")) {
          const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
          if (match && (!match[2] || match[2].length === 0)) {
            return {
              type: "text" as const,
              text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
            }
          }
        }
      }

      const mime = part.type === "image" ? part.image.toString().split(";")[0].replace("data:", "") : part.mediaType
      const filename = part.type === "file" ? part.filename : undefined
      const modality = mimeToModality(mime)
      if (!modality) return part
      if (model.capabilities.input[modality]) return part

      const name = filename ? `"${filename}"` : modality
      return {
        type: "text" as const,
        text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
      }
    })

    return { ...msg, content: filtered }
  })
}

export function normalizeAnthropic(msgs: ModelMessage[]) {
  return msgs
    .map((msg) => {
      if (typeof msg.content === "string") {
        if (msg.content === "") return undefined
        return msg
      }
      if (!Array.isArray(msg.content)) return msg
      const filtered = msg.content.filter((part) => {
        if (part.type === "text" || part.type === "reasoning") {
          return part.text !== ""
        }
        return true
      })
      if (filtered.length === 0) return undefined
      return { ...msg, content: filtered }
    })
    .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
}

export function scrubClaude(msgs: ModelMessage[]) {
  const scrub = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_")
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part.type === "tool-call" || part.type === "tool-result") {
            return { ...part, toolCallId: scrub(part.toolCallId) }
          }
          return part
        }),
      }
    }
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part.type === "tool-result") {
            return { ...part, toolCallId: scrub(part.toolCallId) }
          }
          return part
        }),
      }
    }
    return msg
  })
}

export function scrubMistral(msgs: ModelMessage[]) {
  const scrub = (id: string) => {
    return id
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 9)
      .padEnd(9, "0")
  }
  const result: ModelMessage[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const nextMsg = msgs[i + 1]

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if (part.type === "tool-call" || part.type === "tool-result") {
          return { ...part, toolCallId: scrub(part.toolCallId) }
        }
        return part
      })
    }
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if (part.type === "tool-result") {
          return { ...part, toolCallId: scrub(part.toolCallId) }
        }
        return part
      })
    }
    result.push(msg)

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

export function normalizeInterleaved(msgs: ModelMessage[], model: Provider.Model) {
  if (typeof model.capabilities.interleaved !== "object" || !model.capabilities.interleaved.field) return msgs
  const field = model.capabilities.interleaved.field
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
      const reasoningText = reasoningParts.map((part: any) => part.text).join("")
      const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning")

      if (reasoningText) {
        return {
          ...msg,
          content: filteredContent,
          providerOptions: {
            ...msg.providerOptions,
            openaiCompatible: {
              ...(msg.providerOptions as any)?.openaiCompatible,
              [field]: reasoningText,
            },
          },
        }
      }

      return {
        ...msg,
        content: filteredContent,
      }
    }

    return msg
  })
}

export function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
  const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

  const providerOptions = {
    anthropic: {
      cacheControl: { type: "ephemeral" },
    },
    openrouter: {
      cacheControl: { type: "ephemeral" },
    },
    bedrock: {
      cachePoint: { type: "default" },
    },
    openaiCompatible: {
      cache_control: { type: "ephemeral" },
    },
    copilot: {
      copilot_cache_control: { type: "ephemeral" },
    },
  }

  for (const msg of unique([...system, ...final])) {
    const useMessageLevelOptions =
      model.providerID === "anthropic" ||
      model.providerID.includes("bedrock") ||
      model.api.npm === "@ai-sdk/amazon-bedrock"
    const shouldUseContentOptions = !useMessageLevelOptions && Array.isArray(msg.content) && msg.content.length > 0

    if (shouldUseContentOptions) {
      const lastContent = msg.content[msg.content.length - 1]
      if (
        lastContent &&
        typeof lastContent === "object" &&
        lastContent.type !== "tool-approval-request" &&
        lastContent.type !== "tool-approval-response"
      ) {
        lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions)
        continue
      }
    }

    msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
  }

  return msgs
}

export function shouldCache(model: Provider.Model) {
  return (
    (model.providerID === "anthropic" ||
      model.providerID === "google-vertex-anthropic" ||
      model.api.id.includes("anthropic") ||
      model.api.id.includes("claude") ||
      model.id.includes("anthropic") ||
      model.id.includes("claude") ||
      model.api.npm === "@ai-sdk/anthropic") &&
    model.api.npm !== "@ai-sdk/gateway"
  )
}

export function remapProviderOptions(msgs: ModelMessage[], model: Provider.Model) {
  const key = sdkKey(model.api.npm)
  if (!key || key === model.providerID) return msgs

  const remap = (opts: Record<string, any> | undefined) => {
    if (!opts) return opts
    if (!(model.providerID in opts)) return opts
    const result = { ...opts }
    result[key] = result[model.providerID]
    delete result[model.providerID]
    return result
  }

  return msgs.map((msg) => {
    if (!Array.isArray(msg.content)) return { ...msg, providerOptions: remap(msg.providerOptions) }
    return {
      ...msg,
      providerOptions: remap(msg.providerOptions),
      content: msg.content.map((part) => {
        if (part.type === "tool-approval-request" || part.type === "tool-approval-response") {
          return { ...part }
        }
        return { ...part, providerOptions: remap(part.providerOptions) }
      }),
    } as typeof msg
  })
}

export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
  if (model.api.npm === "@ai-sdk/gateway") {
    const i = model.api.id.indexOf("/")
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined
    const gateway = options.gateway
    const rest = Object.fromEntries(Object.entries(options).filter(([k]) => k !== "gateway"))
    const has = Object.keys(rest).length > 0

    const result: Record<string, any> = {}
    if (gateway !== undefined) result.gateway = gateway

    if (has) {
      if (slug) {
        result[slug] = rest
      } else if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
        result.gateway = { ...gateway, ...rest }
      } else {
        result.gateway = rest
      }
    }

    return result
  }

  const key = sdkKey(model.api.npm) ?? model.providerID
  if (model.api.npm === "@ai-sdk/azure") {
    return { openai: options, azure: options }
  }
  return { [key]: options }
}

export function schema(model: Provider.Model, schema: JSONSchema.BaseSchema | JSONSchema7): JSONSchema7 {
  if (model.providerID === "google" || model.api.id.includes("gemini")) {
    const isPlainObject = (node: unknown): node is Record<string, any> =>
      typeof node === "object" && node !== null && !Array.isArray(node)
    const hasCombiner = (node: unknown) =>
      isPlainObject(node) && (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf))
    const hasSchemaIntent = (node: unknown) => {
      if (!isPlainObject(node)) return false
      if (hasCombiner(node)) return true
      return [
        "type",
        "properties",
        "items",
        "prefixItems",
        "enum",
        "const",
        "$ref",
        "additionalProperties",
        "patternProperties",
        "required",
        "not",
        "if",
        "then",
        "else",
      ].some((key) => key in node)
    }

    const sanitizeGemini = (obj: any): any => {
      if (obj === null || typeof obj !== "object") return obj
      if (Array.isArray(obj)) return obj.map(sanitizeGemini)

      const result: any = {}
      for (const [key, value] of Object.entries(obj)) {
        if (key === "enum" && Array.isArray(value)) {
          result[key] = value.map((v) => String(v))
          if (result.type === "integer" || result.type === "number") {
            result.type = "string"
          }
        } else if (typeof value === "object" && value !== null) {
          result[key] = sanitizeGemini(value)
        } else {
          result[key] = value
        }
      }

      if (result.type === "object" && result.properties && Array.isArray(result.required)) {
        result.required = result.required.filter((field: any) => field in result.properties)
      }

      if (result.type === "array" && !hasCombiner(result)) {
        if (result.items == null) {
          result.items = {}
        }
        if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
          result.items.type = "string"
        }
      }

      if (result.type && result.type !== "object" && !hasCombiner(result)) {
        delete result.properties
        delete result.required
      }

      return result
    }

    schema = sanitizeGemini(schema)
  }

  return schema as JSONSchema7
}
