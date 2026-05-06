import { Adapter, type AdapterRoutedModelInput } from "../adapter/client"
import { Endpoint } from "../adapter/endpoint"
import { Framing } from "../adapter/framing"
import { capabilities } from "../llm"
import * as OpenAIChat from "./openai-chat"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<AdapterRoutedModelInput, "baseURL"> & {
  readonly baseURL: string
}

/**
 * Adapter for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses `OpenAIChat.protocol` end-to-end and
 * only overrides:
 *
 * - the adapter id (`openai-compatible-chat`) so providers can be resolved
 *   per-family without colliding with native OpenAI;
 * - the endpoint, which requires `model.baseURL` (no provider default).
 */
export const adapter = Adapter.make({
  id: ADAPTER,
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.baseURL({
    path: "/chat/completions",
    required: "OpenAI-compatible Chat requires a baseURL",
  }),
  framing: Framing.sse,
})

export const model = Adapter.model<OpenAICompatibleChatModelInput>(adapter, {
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
