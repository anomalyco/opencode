import { APICallError, type LanguageModelMiddleware } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"

// Copilot → Bedrock model ID mapping for provider fallback.
// Bedrock inference-profile IDs use the us. cross-region prefix.
// Both us. and global. prefixes are ACTIVE per list-inference-profiles
// and confirmed working via direct invoke-model testing (2026-03-08).
export namespace ProviderFallback {
  const log = Log.create({ service: "fallback" })

  // sourceProvider → sourceModel → targetModel (just the model ID, no provider prefix)
  const models: Record<string, Record<string, string>> = {
    "github-copilot": {
      "claude-sonnet-4.6": "us.anthropic.claude-sonnet-4-6",
      "claude-opus-4.6": "us.anthropic.claude-opus-4-6-v1",
      "claude-haiku-4.5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    },
  }

  // Resolves a fallback target for the given provider/model pair.
  // Uses the config fallback map to find the target provider,
  // then the built-in model mapping table to translate model IDs.
  // Returns undefined if no fallback is configured or no model mapping exists.
  export function resolve(providerID: string, modelID: string, fallback?: Record<string, string>) {
    if (!fallback) return undefined
    const target = fallback[providerID]
    if (!target) return undefined
    const mapped = models[providerID]?.[modelID]
    if (!mapped) return undefined
    return { providerID: target, modelID: mapped }
  }

  // Full overflow pattern list — mirrors error.ts OVERFLOW_PATTERNS.
  // Context overflow must trigger compaction, never provider fallback.
  const OVERFLOW = [
    /prompt is too long/i,
    /input is too long for requested model/i,
    /exceeds the context window/i,
    /input token count.*exceeds the maximum/i,
    /maximum prompt length is \d+/i,
    /reduce the length of the messages/i,
    /maximum context length is \d+ tokens/i,
    /exceeds the limit of \d+/i,
    /exceeds the available context size/i,
    /greater than the context length/i,
    /context window exceeds limit/i,
    /exceeded model token limit/i,
    /context[_ ]length[_ ]exceeded/i,
    /request entity too large/i,
    /^4(00|13)\s*(status code)?\s*\(no body\)/i,
  ]

  // Determines whether an error from the primary provider should trigger
  // a fallback attempt on the secondary provider. Called inside the
  // wrapStream/wrapGenerate middleware catch block with the raw error.
  //
  // Fallback-worthy: transient gateway/rate errors where a different
  // provider likely succeeds (403, 429, 503, 500, bare-400 from Copilot),
  // network failures (ECONNREFUSED, ECONNRESET, timeouts).
  // 403 is included because the copilot gateway returns transient 403s
  // for rate/capacity reasons; the fallback model table only maps copilot
  // providers so this won't affect providers where 403 means real auth failure.
  //
  // NOT fallback-worthy: auth failures (401 — different provider
  // has different creds, but the request shape is fine), context overflow
  // (413 / overflow patterns — needs compaction, not a provider switch),
  // and validation errors (prompt issues stay broken on any provider).
  export function shouldFallback(err: unknown): boolean {
    if (APICallError.isInstance(err)) {
      const status = err.statusCode
      // Auth errors — won't fix by switching provider
      if (status === 401) return false
      // Context overflow — needs compaction
      if (status === 413) return false
      if (err.message && OVERFLOW.some((p) => p.test(err.message))) return false
      // Rate limits, gateway errors, and transient 403 — fallback
      if (status === 429 || status === 503 || status === 500 || status === 502 || status === 403) return true
      // Copilot bare-400: text/plain body, no JSON — transient rate limit
      if (status === 400 && err.responseBody && !isJSON(err.responseBody)) return true
      // SDK-wrapped network errors: no statusCode but marked retryable
      // (AI SDK wraps ECONNREFUSED/ECONNRESET into APICallError)
      if (status === undefined && err.isRetryable) return true
      return false
    }
    // AbortSignal.timeout() fires DOMException with name "TimeoutError"
    // (provider.ts applies AbortSignal.timeout on every fetch call)
    if (err instanceof DOMException && err.name === "TimeoutError") return true
    // Raw network failures not wrapped by AI SDK
    if (err instanceof TypeError) return true
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ECONNREFUSED") return true
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ECONNRESET") return true
    return false
  }

  function isJSON(input: string) {
    try {
      const r = JSON.parse(input)
      return r && typeof r === "object"
    } catch {
      return false
    }
  }

  // Creates an AI SDK middleware that attempts the primary provider,
  // and on shouldFallback-worthy errors retries once on the fallback model.
  // If the fallback also fails, the error propagates to the session retry loop.
  export function middleware(fallback: LanguageModelV3): LanguageModelMiddleware {
    return {
      specificationVersion: "v3" as const,
      wrapGenerate: async ({ doGenerate, params }) => {
        try {
          return await doGenerate()
        } catch (err) {
          if (!shouldFallback(err)) throw err
          log.info("fallback", {
            target: fallback.modelId,
            error: err instanceof Error ? err.message : String(err),
            status: APICallError.isInstance(err) ? err.statusCode : undefined,
          })
          Bus.publish(TuiEvent.ToastShow, {
            title: "Provider fallback activated",
            message: `Switched to ${fallback.modelId}`,
            variant: "warning",
          }).catch(() => {})
          return await fallback.doGenerate(params)
        }
      },
      wrapStream: async ({ doStream, params }) => {
        try {
          return await doStream()
        } catch (err) {
          if (!shouldFallback(err)) throw err
          log.info("fallback", {
            target: fallback.modelId,
            error: err instanceof Error ? err.message : String(err),
            status: APICallError.isInstance(err) ? err.statusCode : undefined,
          })
          Bus.publish(TuiEvent.ToastShow, {
            title: "Provider fallback activated",
            message: `Switched to ${fallback.modelId}`,
            variant: "warning",
          }).catch(() => {})
          return await fallback.doStream(params)
        }
      },
    }
  }
}
