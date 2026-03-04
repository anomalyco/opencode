/**
 * v2→v3 provider/model shim for AI SDK legacy compatibility.
 *
 * AI SDK v6 uses specification version "v3" for providers and language models.
 * Third-party packages that were built against AI SDK v5 may still produce
 * v2-spec objects. This module wraps those objects transparently so all
 * downstream code in opencode consistently sees v3-spec providers and models.
 *
 * The shim mirrors the internal asProviderV3 / asLanguageModelV3 logic from
 * the "ai" package (which is not exported publicly) and adds structured logging
 * so legacy providers are easy to identify at runtime.
 *
 * Fast-path: already-v3 objects are returned unchanged with no overhead.
 */

import { Log } from "../util/log"

const log = Log.create({ service: "provider-shim" })

function convertFinishReason(reason: string) {
  return { unified: reason === "unknown" ? "other" : reason, raw: undefined }
}

function convertUsage(u: {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
}) {
  return {
    inputTokens: {
      total: u.inputTokens,
      noCache: undefined,
      cacheRead: u.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: u.outputTokens,
      text: undefined,
      reasoning: u.reasoningTokens,
    },
  }
}

function convertStream(s: ReadableStream) {
  return s.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "finish") {
          controller.enqueue({
            ...chunk,
            finishReason: convertFinishReason(chunk.finishReason),
            usage: convertUsage(chunk.usage),
          })
        } else {
          controller.enqueue(chunk)
        }
      },
    }),
  )
}

export function shimLanguageModel(model: any): any {
  if (model.specificationVersion === "v3") return model
  log.info("shimming v2 language model to v3", {
    provider: model.provider,
    modelId: model.modelId,
  })
  return new Proxy(model, {
    get(target, prop) {
      switch (prop) {
        case "specificationVersion":
          return "v3"
        case "doGenerate":
          return async (...args: any[]) => {
            const result = await target.doGenerate(...args)
            return {
              ...result,
              finishReason: convertFinishReason(result.finishReason),
              usage: convertUsage(result.usage),
            }
          }
        case "doStream":
          return async (...args: any[]) => {
            const result = await target.doStream(...args)
            return { ...result, stream: convertStream(result.stream) }
          }
        default:
          return target[prop]
      }
    },
  })
}

export function shimProvider(sdk: any): any {
  if (sdk.specificationVersion === "v3") return sdk
  log.info("shimming v2 provider to v3", { provider: sdk.provider ?? sdk.id ?? "(unknown)" })

  // Use a Proxy rather than a plain object so that callable providers (e.g.
  // SAP AI Core exposes provider(modelId) as a shorthand) keep working after
  // shimming. The apply trap forwards calls to the original and shims the
  // returned language model. The get trap layers v3 property overrides on
  // top of the original properties.
  return new Proxy(sdk, {
    apply(target, thisArg, args) {
      return shimLanguageModel(Reflect.apply(target, thisArg, args))
    },
    get(target, prop) {
      switch (prop) {
        case "specificationVersion":
          return "v3"
        case "languageModel":
          return (id: string) => shimLanguageModel(target.languageModel(id))
        case "embeddingModel":
          // v2 providers expose textEmbeddingModel; v3 renames it to embeddingModel
          return target.textEmbeddingModel
            ? (id: string) => target.textEmbeddingModel(id)
            : target.embeddingModel
              ? (id: string) => target.embeddingModel(id)
              : undefined
        case "rerankingModel":
          // v2 providers have no reranking concept
          return undefined
        default:
          return target[prop]
      }
    },
  })
}
