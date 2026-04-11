import type { ModelMessage } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { JSONSchema } from "zod/v4/core"
import { Flag } from "@/flag/flag"
import type { Provider } from "../provider"
import { kind } from "./kind"
import * as anthropic from "./family/anthropic"
import * as azure from "./family/azure"
import * as bedrock from "./family/bedrock"
import * as copilot from "./family/copilot"
import * as custom from "./family/custom"
import * as gateway from "./family/gateway"
import * as generic from "./family/generic"
import * as google from "./family/google"
import * as groq from "./family/groq"
import * as mistral from "./family/mistral"
import * as openai from "./family/openai"
import * as opencode from "./family/opencode"
import * as compatible from "./family/openai-compatible"
import * as openrouter from "./family/openrouter"
import * as sap from "./family/sap"
import * as venice from "./family/venice"
import * as xai from "./family/xai"
import {
  normalizeInterleaved,
  providerOptions as providerOptionsImpl,
  remapProviderOptions,
  schema as schemaImpl,
  shouldCache,
  unsupportedParts,
} from "./shared"
import type { Input, Transform } from "./types"

const all: Record<ReturnType<typeof kind>, Transform> = {
  generic,
  openai,
  azure,
  copilot,
  "openai-compatible": compatible,
  openrouter,
  gateway,
  google,
  anthropic,
  bedrock,
  groq,
  xai,
  venice,
  opencode,
  sap,
  mistral,
  custom,
}

function impl(model: Provider.Model) {
  return all[kind(model)]
}

function normalize(msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>) {
  msgs = unsupportedParts(msgs, model)
  msgs = impl(model).normalize?.(msgs, model, options) ?? msgs
  // Interleaved reasoning extraction remains generic because it only depends on
  // the model capability contract, not on provider-specific transport rules.
  msgs = normalizeInterleaved(msgs, model)
  if (shouldCache(model)) {
    msgs = impl(model).cache?.(msgs, model) ?? msgs
  }
  return remapProviderOptions(msgs, model)
}

function getTemperature(model: Provider.Model) {
  const id = model.id.toLowerCase()
  if (id.includes("qwen")) return 0.55
  if (id.includes("claude")) return undefined
  if (id.includes("gemini")) return 1.0
  if (id.includes("glm-4.6")) return 1.0
  if (id.includes("glm-4.7")) return 1.0
  if (id.includes("minimax-m2")) return 1.0
  if (id.includes("kimi-k2")) {
    if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
      return 1.0
    }
    return 0.6
  }
  return undefined
}

function getTopP(model: Provider.Model) {
  const id = model.id.toLowerCase()
  if (id.includes("qwen")) return 1
  if (["minimax-m2", "gemini", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) => id.includes(s))) {
    return 0.95
  }
  return undefined
}

function getTopK(model: Provider.Model) {
  const id = model.id.toLowerCase()
  if (id.includes("minimax-m2")) {
    if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40
    return 20
  }
  if (id.includes("gemini")) return 64
  return undefined
}

function getMaxOutputTokens(model: Provider.Model): number {
  return Math.min(model.limit.output, ProviderTransform.OUTPUT_TOKEN_MAX) || ProviderTransform.OUTPUT_TOKEN_MAX
}

export namespace ProviderTransform {
  export const OUTPUT_TOKEN_MAX = Flag.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export const message = normalize
  export const temperature = getTemperature
  export const topP = getTopP
  export const topK = getTopK
  export const maxOutputTokens = getMaxOutputTokens
  export const providerOptions = providerOptionsImpl
  export const schema = schemaImpl

  export function variants(model: Provider.Model) {
    return impl(model).variants(model)
  }

  export function options(input: Input): Record<string, any> {
    const result = impl(input.model).options(input)
    if (input.providerOptions?.setCacheKey && result.promptCacheKey === undefined) {
      result.promptCacheKey = input.sessionID
    }
    return result
  }

  export function smallOptions(model: Provider.Model) {
    return impl(model).small(model)
  }
}
