import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ProviderError } from "./error"

type NamedErrorObject = {
  name: string
  data: {
    statusCode?: number
    isRetryable?: boolean
    message?: string
  }
}

export function shouldFallback(error: NamedErrorObject | Error): boolean {
  if (error instanceof ProviderError.HeaderTimeoutError) return true
  if (error instanceof ProviderError.ResponseStreamError) return true
  if (!("name" in error)) return false
  if (error.name === "ContextOverflowError") return false
  if (error.name === "ProviderAuthError") return false
  if (error.name === "APIError") {
    const data = (error as NamedErrorObject).data
    const status = data?.statusCode
    if (status === 401) return false
    if (status === 413) return false
    // 404 is fallback-worthy: for OpenAI-compatible providers it usually means
    // model-not-found (the model was retired or misconfigured), so falling back
    // to the next model is correct. A wrong base URL also returns 404, but that
    // is a config error that should be fixed at the provider level, not here.
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 404) return true
    if (status === undefined && data?.isRetryable) return true
    return false
  }
  return false
}

export function resolveFallback(
  current: { providerID: string; modelID: string },
  config: ConfigV1.Info,
  tried: Set<string> = new Set(),
): { providerID: string; modelID: string } | undefined {
  // Note: does not validate that the target provider/model exists in config.
  // A non-existent target is logged as a warning in the processor and treated
  // as "no fallback available". Validating against the provider list would
  // require a runtime check; for now, config errors surface as warnings.
  const provider = config.provider?.[current.providerID]
  if (!provider?.models) return undefined
  const model = provider.models[current.modelID]
  if (!model?.fallback) return undefined
  const entry = model.fallback.find((e) => {
    if (tried.has(e)) return false
    const slash = e.indexOf("/")
    return slash > 0 && slash < e.length - 1
  })
  if (!entry) return undefined
  const slash = entry.indexOf("/")
  return { providerID: entry.slice(0, slash), modelID: entry.slice(slash + 1) }
}

export * as ProviderFallback from "./fallback"
