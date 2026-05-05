import { Adapter, type AdapterModelInput } from "../adapter"
import { capabilities } from "../llm"
import { payload as payloadPatch } from "../patch"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat"
import { OpenAICompatibleProfiles } from "./openai-compatible-profile"
import type { OpenAIChatPayload } from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.openrouter

export interface OpenRouterOptions {
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type ModelOptions = Omit<AdapterModelInput, "id"> & OpenRouterOptions

const nativeOptions = (options: ModelOptions) => {
  const openrouter = {
    ...(isRecord(options.native?.openrouter) ? options.native.openrouter : {}),
    ...(options.usage === undefined ? {} : { usage: options.usage === true ? { include: true } : options.usage }),
    ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
    ...(options.promptCacheKey === undefined ? {} : { promptCacheKey: options.promptCacheKey }),
  }
  if (Object.keys(openrouter).length === 0) return options.native
  return { ...options.native, openrouter }
}

export const applyOptions = payloadPatch<OpenAIChatPayload>("openrouter.options", {
  reason: "apply OpenRouter provider options to the Chat payload",
  when: (context) => context.model.provider === profile.provider && isRecord(context.model.native?.openrouter),
  apply: (payload, context) => {
    const openrouter = isRecord(context.model.native?.openrouter) ? context.model.native.openrouter : undefined
    if (!openrouter) return payload
    return {
      ...payload,
      ...(openrouter.usage === true ? { usage: { include: true } } : isRecord(openrouter.usage) ? { usage: openrouter.usage } : {}),
      ...(isRecord(openrouter.reasoning) ? { reasoning: openrouter.reasoning } : {}),
      ...(typeof openrouter.promptCacheKey === "string" ? { prompt_cache_key: openrouter.promptCacheKey } : {}),
    }
  },
})

export const adapter = OpenAICompatibleChat.adapter.withPatches([applyOptions])

export const adapters = [adapter]

const modelRef = Adapter.model<AdapterModelInput>(adapter, {
  provider: profile.provider,
  baseURL: profile.baseURL,
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
})

export const model = (id: string, options: ModelOptions = {}) =>
  modelRef({ ...options, id, native: nativeOptions(options) })

export const chat = model

export * as OpenRouter from "./openrouter"
