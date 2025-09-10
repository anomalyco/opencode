import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/util/zen"

export function POST(input: APIEvent) {
  return handler(input, {
    transformBody: (body: any) => ({
      ...body,
      stream_options: {
        include_usage: true,
      },
    }),
    parseUsageChunk: (chunk: string) => {
      if (!chunk.startsWith("data: ")) return

      let json
      try {
        json = JSON.parse(chunk.slice(6))
      } catch (e) {
        return
      }

      return json.usage
    },
    buildUsage: (usage: any) => ({
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      //cacheWriteTokens = usage.providerMetadata?.["anthropic"]?.["cacheCreationInputTokens"] ?? 0
      cacheWriteTokens: 0,
    }),
  })
}
