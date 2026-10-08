export * as PromptCache from "./prompt-cache.js"

import type { Options } from "@opencode/schema/prompt-cache"
import { Effect } from "effect"
import { LLMRequest } from "./schema/messages.js"
import { ProviderShared } from "./protocols/shared.js"

/** Apply native retention options without making Session or config decisions in the provider layer. */
export const apply = Effect.fn("PromptCache.apply")(function* (request: LLMRequest, options: Options) {
  const control = options.cache_control
  const retention = options.prompt_cache_retention
  const route = request.model.route.id
  if (control !== undefined && retention !== undefined)
    return yield* ProviderShared.invalidRequest("cache_control and prompt_cache_retention cannot be combined")
  if (control !== undefined) {
    if (route !== "anthropic-messages" && route !== "google-vertex-messages" && route !== "bedrock-mantle-messages")
      return yield* ProviderShared.invalidRequest(`cache_control is not supported by cache rules for route ${route}`)
    return LLMRequest.update(request, {
      cache: { tools: true, system: true, messages: { tail: 1 }, ttlSeconds: control.ttl === "1h" ? 3600 : 300 },
    })
  }
  if (retention === undefined) return request
  if (route !== "openai-chat" && route !== "openai-responses")
    return yield* ProviderShared.invalidRequest(
      `prompt_cache_retention is not supported by cache rules for route ${route}`,
    )

  // Native model IDs expose these known incompatibilities; deployment aliases and account restrictions
  // are validated by the API. Never infer support from the configured provider's user-chosen name.
  const gpt = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/.exec(request.model.id)
  if (gpt && (Number(gpt[1]) > 5 || (Number(gpt[1]) === 5 && Number(gpt[2] ?? 0) >= 6)))
    return yield* ProviderShared.invalidRequest(
      `${request.model.id} uses prompt_cache_options rather than prompt_cache_retention; remove this cache rule or restrict its model condition`,
    )
  if (/^gpt-5\.5(?:-|$)/.test(request.model.id) && retention !== "24h")
    return yield* ProviderShared.invalidRequest(`${request.model.id} only supports prompt_cache_retention: "24h"`)
  if (/^gpt-[123](?:\.|-|$)/.test(request.model.id))
    return yield* ProviderShared.invalidRequest(`${request.model.id} does not support prompt_cache_retention`)

  return LLMRequest.update(request, {
    providerOptions: { ...request.providerOptions, promptCacheRetention: retention },
  })
})
