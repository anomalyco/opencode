import { ProviderHelper } from "./provider"

/*
{
  promptTokenCount: 11453,
  candidatesTokenCount: 71,
  totalTokenCount: 11625,
  cachedContentTokenCount: 8100,
  promptTokensDetails: [
    {modality: "TEXT",tokenCount: 11453}
  ],
  cacheTokensDetails: [
    {modality: "TEXT",tokenCount: 8100}
  ],
  thoughtsTokenCount: 101
}
*/

type Usage = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  cachedContentTokenCount?: number
  promptTokensDetails?: { modality: string; tokenCount: number }[]
  cacheTokensDetails?: { modality: string; tokenCount: number }[]
  thoughtsTokenCount?: number
}

export const googleHelper: ProviderHelper = ({ providerModel }) => ({
  format: "google",
  modifyUrl: (providerApi: string, isStream?: boolean) =>
    `${providerApi}/models/${providerModel}:${isStream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
  modifyHeaders: (headers: Headers, body: Record<string, any>, apiKey: string) => {
    headers.set("x-goog-api-key", apiKey)
  },
  modifyBody: (body: Record<string, any>) => {
    return body
  },
  createBinaryStreamDecoder: () => undefined,
  streamSeparator: "\r\n\r\n",
  createUsageParser: () => {
    let usage: Usage

    return {
      parse: (chunk: string) => {
        if (!chunk.startsWith("data: ")) return

        let json
        try {
          json = JSON.parse(chunk.slice(6)) as { usageMetadata?: Usage }
        } catch (e) {
          return
        }

        if (!json.usageMetadata) return
        usage = json.usageMetadata
      },
      retrieve: () => usage,
    }
  },
  normalizeUsage: (usage: Usage) => {
    const inputTokens = usage.promptTokenCount ?? 0
    const outputTokens = usage.candidatesTokenCount ?? 0
    const reasoningTokens = usage.thoughtsTokenCount ?? 0
    const cacheReadTokens = usage.cachedContentTokenCount ?? 0
    return {
      inputTokens: inputTokens - cacheReadTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWrite5mTokens: undefined,
      cacheWrite1hTokens: undefined,
    }
  },
})
