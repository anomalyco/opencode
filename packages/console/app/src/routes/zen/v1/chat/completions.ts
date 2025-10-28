import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/handler"

type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  // used by moonshot
  cached_tokens?: number
  // used by xai
  prompt_tokens_details?: {
    text_tokens?: number
    audio_tokens?: number
    image_tokens?: number
    cached_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
    audio_tokens?: number
    accepted_prediction_tokens?: number
    rejected_prediction_tokens?: number
  }
}

export function POST(input: APIEvent) {
  let usage: Usage
  return handler(input, {
    modifyBody: (body: any) => ({
      ...body,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    }),
    setAuthHeader: (headers: Headers, apiKey: string) => {
      headers.set("authorization", `Bearer ${apiKey}`)
    },
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
    onStreamPart: (chunk: string) => {
      if (!chunk.startsWith("data: ")) return

      let json
      try {
        json = JSON.parse(chunk.slice(6)) as { usage?: Usage }
      } catch (e) {
        return
      }

      if (!json.usage) return
      usage = json.usage
    },
    getStreamUsage: () => usage,
    normalizeUsage: (usage: Usage) => {
      const inputTokens = usage.prompt_tokens ?? 0
      const outputTokens = usage.completion_tokens ?? 0
      const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? undefined
      const cacheReadTokens = usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? undefined
      return {
        inputTokens: inputTokens - (cacheReadTokens ?? 0),
        outputTokens: outputTokens - (reasoningTokens ?? 0),
        reasoningTokens,
        cacheReadTokens,
      }
    },
  })
}
