import { Adapter, type AdapterRoutedModelInput } from "../adapter"
import { Endpoint } from "../endpoint"
import { Framing } from "../framing"
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

export const includeUsage = adapter.patch("include-usage", {
  reason: "request final usage chunk from OpenAI-compatible Chat streaming responses",
  apply: (payload) => ({
    ...payload,
    stream_options: { ...payload.stream_options, include_usage: true },
  }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
