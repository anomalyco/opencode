import { ProviderHelper, CommonRequest, CommonResponse, CommonChunk } from "./provider"

type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: {
    cached_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
  }
}

export const gatewayzHelper = {
  format: "oa-compat",
  modifyUrl: (providerApi: string) => providerApi + "/v1/chat/completions",
  modifyHeaders: (headers: Headers, body: Record<string, any>, apiKey: string) => {
    headers.set("authorization", `Bearer ${apiKey}`)
  },
  modifyBody: (body: Record<string, any>) => {
    return {
      ...body,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    }
  },
  streamSeparator: "\n\n",
  createUsageParser: () => {
    let usage: Usage

    return {
      parse: (chunk: string) => {
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
      retrieve: () => usage,
    }
  },
  normalizeUsage: (usage: Usage) => {
    const inputTokens = usage.prompt_tokens ?? 0
    const outputTokens = usage.completion_tokens ?? 0
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? undefined
    const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? undefined
    return {
      inputTokens: inputTokens - (cacheReadTokens ?? 0),
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWrite5mTokens: undefined,
      cacheWrite1hTokens: undefined,
    }
  },
} satisfies ProviderHelper
