import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/handler"

type Usage = {
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
  server_tool_use?: {
    web_search_requests?: number
  }
}

export function POST(input: APIEvent) {
  let usage: Usage
  return handler(input, {
    modifyBody: (body: any) => ({
      ...body,
      service_tier: "standard_only",
    }),
    setAuthHeader: (headers: Headers, apiKey: string) => headers.set("x-api-key", apiKey),
    parseApiKey: (headers: Headers) => headers.get("x-api-key") ?? undefined,
    onStreamPart: (chunk: string) => {
      const data = chunk.split("\n")[1]
      if (!data.startsWith("data: ")) return

      let json
      try {
        json = JSON.parse(data.slice(6))
      } catch (e) {
        return
      }

      // ie. { type: "message_start"; message: { usage: Usage } }
      // ie. { type: "message_delta"; usage: Usage }
      const usageUpdate = json.usage ?? json.message?.usage
      if (!usageUpdate) return
      usage = {
        ...usage,
        ...usageUpdate,
        cache_creation: {
          ...usage?.cache_creation,
          ...usageUpdate.cache_creation,
        },
        server_tool_use: {
          ...usage?.server_tool_use,
          ...usageUpdate.server_tool_use,
        },
      }
    },
    getStreamUsage: () => usage,
    normalizeUsage: (usage: Usage) => ({
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
      cacheWrite5mTokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? undefined,
      cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? undefined,
    }),
  })
}
