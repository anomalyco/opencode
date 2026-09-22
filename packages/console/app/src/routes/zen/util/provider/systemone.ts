import { ProviderHelper } from "./provider"

type Usage = {
  input_tokens?: number
  output_tokens?: number
}

export const systemoneHelper: ProviderHelper = () => ({
  format: "systemone",
  modifyUrl: (providerApi: string) => providerApi.replace(/\/$/, "") + "/systemone",
  modifyHeaders: (headers: Headers, apiKey: string, stickyId: string) => {
    headers.set("authorization", `Bearer ${apiKey}`)
    headers.set("x-session-affinity", stickyId)
  },
  modifyBody: (body: Record<string, any>) => body,
  createBinaryStreamDecoder: () => undefined,
  createUsageParser: () => ({
    parse: (_chunk: string) => {},
    retrieve: () => undefined,
  }),
  extractUsage: (response: any) => response.usage,
  normalizeUsage: (usage: Usage) => ({
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: undefined,
    cacheReadTokens: undefined,
    cacheWrite5mTokens: undefined,
    cacheWrite1hTokens: undefined,
  }),
})
