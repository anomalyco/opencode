import { ProviderID } from "../schema"
import { ProviderResolver } from "../provider-resolver"
import { OpenAICompatibleChat, type OpenAICompatibleChatModelInput } from "./openai-compatible-chat"

export type ModelOptions = Omit<OpenAICompatibleChatModelInput, "id" | "provider"> & {
  readonly provider: string
}

export const resolver = ProviderResolver.fixed("openai-compatible", "openai-compatible-chat")

export const adapters = [OpenAICompatibleChat.adapter]

export const model = (id: string, options: ModelOptions) => {
  return OpenAICompatibleChat.model({
    ...options,
    id,
    provider: ProviderID.make(options.provider),
  })
}

export const chat = model

export * as OpenAICompatible from "./openai-compatible"
