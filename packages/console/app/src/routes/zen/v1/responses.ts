import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/handler"

type Usage = {
  input_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
  }
  output_tokens?: number
  output_tokens_details?: {
    reasoning_tokens?: number
  }
  total_tokens?: number
}

export function POST(input: APIEvent) {
  let usage: Usage
  return handler(input, {
    setAuthHeader: (headers: Headers, apiKey: string) => {
      headers.set("authorization", `Bearer ${apiKey}`)
    },
    parseApiKey: (headers: Headers) => headers.get("authorization")?.split(" ")[1],
    onStreamPart: (chunk: string) => {
      const [event, data] = chunk.split("\n")
      if (event !== "event: response.completed") return
      if (!data.startsWith("data: ")) return

      let json
      try {
        json = JSON.parse(data.slice(6)) as { response?: { usage?: Usage } }
      } catch (e) {
        return
      }

      if (!json.response?.usage) return
      usage = json.response.usage
    },
    getStreamUsage: () => usage,
    normalizeUsage: (usage: Usage) => {
      const inputTokens = usage.input_tokens ?? 0
      const outputTokens = usage.output_tokens ?? 0
      const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? undefined
      const cacheReadTokens = usage.input_tokens_details?.cached_tokens ?? undefined
      return {
        inputTokens: inputTokens - (cacheReadTokens ?? 0),
        outputTokens: outputTokens - (reasoningTokens ?? 0),
        reasoningTokens,
        cacheReadTokens,
      }
    },
  })
}
