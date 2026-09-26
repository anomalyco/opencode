// Minimal AI SDK LanguageModelV2 implementation used to regression-test the
// dynamic-provider usage-loss bug (see session/llm.ts, `isV3LanguageModel`).
// Loaded via `npm: "file://..."` the same way opencode dynamically loads any
// third-party provider package at runtime.
export function createFakeV2Provider() {
  return {
    languageModel(modelId: string) {
      return {
        specificationVersion: "v2" as const,
        provider: "fake-v2",
        modelId,
        supportedUrls: {},
        async doGenerate() {
          throw new Error("fake-v2-provider: doGenerate not implemented")
        },
        async doStream() {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-start", id: "1" })
              controller.enqueue({ type: "text-delta", id: "1", delta: "OK" })
              controller.enqueue({ type: "text-end", id: "1" })
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 14, outputTokens: 4, totalTokens: 18 },
              })
              controller.close()
            },
          })
          return { stream }
        },
      }
    },
  }
}
