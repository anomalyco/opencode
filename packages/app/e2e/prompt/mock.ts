import { createSdk } from "../utils"

export const openaiModel = { providerID: "openai", modelID: "gpt-5.3-chat-latest" }

type Hit = { body: Record<string, unknown> }

export function bodyText(hit: Hit) {
  return JSON.stringify(hit.body)
}

export function titleMatch(hit: Hit) {
  return bodyText(hit).includes("Generate a title for this conversation")
}

export function promptMatch(token: string) {
  return (hit: Hit) => bodyText(hit).includes(token)
}

export async function withMockOpenAI<T>(input: { serverUrl: string; llmUrl: string; fn: () => Promise<T> }) {
  const sdk = createSdk(undefined, input.serverUrl)
  const prev = await sdk.global.config.get().then((res) => res.data ?? {})

  try {
    await sdk.global.config.update({
      config: {
        ...prev,
        model: `${openaiModel.providerID}/${openaiModel.modelID}`,
        enabled_providers: ["openai"],
        provider: {
          ...prev.provider,
          openai: {
            ...prev.provider?.openai,
            options: {
              ...prev.provider?.openai?.options,
              apiKey: "test-key",
              baseURL: input.llmUrl,
            },
          },
        },
      },
    })
    return await input.fn()
  } finally {
    await sdk.global.config.update({ config: prev })
  }
}
