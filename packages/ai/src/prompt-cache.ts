export * as PromptCache from "./prompt-cache.js"

import type { Options } from "@opencode/schema/prompt-cache"
import { Effect, Result } from "effect"
import { withCacheTTL } from "./cache-policy.js"
import { LLMRequest } from "./schema/messages.js"
import { ProviderShared } from "./protocols/shared.js"

/** Apply native retention options without making Session or config decisions in the provider layer. */
export const apply = Effect.fn("PromptCache.apply")(function* (request: LLMRequest, options: Options) {
  const control = options.cache_control
  const retention = options.prompt_cache_retention
  const cache = options.prompt_cache_options
  const route = request.model.route.id
  if (control !== undefined && (retention !== undefined || cache !== undefined))
    return yield* ProviderShared.invalidRequest("cache_control cannot be combined with OpenAI prompt cache options")
  if (control !== undefined) {
    const policy = withCacheTTL(request.model, control.ttl === "1h" ? 3600 : 300)
    if (Result.isFailure(policy)) return yield* ProviderShared.invalidRequest(policy.failure)
    return LLMRequest.update(request, { cache: policy.success })
  }
  if (retention === undefined && cache === undefined) return request
  if (route !== "openai-chat" && route !== "openai-responses")
    return yield* ProviderShared.invalidRequest(
      `OpenAI prompt cache options are not supported by cache rules for route ${route}`,
    )

  return LLMRequest.update(request, {
    providerOptions: {
      ...request.providerOptions,
      ...(retention !== undefined ? { promptCacheRetention: retention } : {}),
      ...(cache !== undefined ? { promptCacheOptions: cache } : {}),
    },
  })
})
