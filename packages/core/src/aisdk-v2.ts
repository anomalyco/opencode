export * as AISDKV2 from "./aisdk-v2.js"

import type {
  LanguageModelV2,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"

export function asLanguageModelV3(model: LanguageModelV2 | LanguageModelV3): LanguageModelV3 {
  if (model.specificationVersion !== "v2") return model
  return new Proxy(model, {
    get(target, prop: keyof LanguageModelV2) {
      if (prop === "specificationVersion") return "v3"
      if (prop === "doGenerate")
        return async (...args: Parameters<LanguageModelV2["doGenerate"]>) => {
          const result = await target.doGenerate(...args)
          return { ...result, finishReason: finishReason(result.finishReason), usage: usage(result.usage) }
        }
      if (prop === "doStream")
        return async (...args: Parameters<LanguageModelV2["doStream"]>) => {
          const result = await target.doStream(...args)
          return { ...result, stream: result.stream.pipeThrough(streamParts()) }
        }
      return target[prop]
    },
  }) as unknown as LanguageModelV3
}

function streamParts() {
  return new TransformStream<LanguageModelV2StreamPart, LanguageModelV3StreamPart>({
    transform(chunk, controller) {
      controller.enqueue(
        chunk.type === "finish"
          ? { ...chunk, finishReason: finishReason(chunk.finishReason), usage: usage(chunk.usage) }
          : (chunk as LanguageModelV3StreamPart),
      )
    },
  })
}

function finishReason(value: LanguageModelV2FinishReason): LanguageModelV3FinishReason {
  return { unified: value === "unknown" ? "other" : value, raw: undefined }
}

function usage(value: LanguageModelV2Usage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: value.inputTokens,
      noCache: undefined,
      cacheRead: value.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: { total: value.outputTokens, text: undefined, reasoning: value.reasoningTokens },
    raw: value.totalTokens == null ? undefined : { totalTokens: value.totalTokens },
  }
}
