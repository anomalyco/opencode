import type { ClassifierProvider } from "../types"

const TIMEOUT_MS = 10_000

/**
 * og-saas / og-local backend: POST the classifier contract to the
 * OpenGuardrails service (`POST {endpoint}/v1/classify`) and map the structured
 * response. Same contract whether the endpoint is the hosted SaaS or a locally
 * served model. Fails closed (`unavailable`) on any error, timeout, non-2xx, or
 * malformed body — the caller then escalates to a human.
 */
export function ogProvider(opts: { endpoint: string; apiKey?: string; label: string }): ClassifierProvider {
  const url = opts.endpoint.replace(/\/+$/, "") + "/v1/classify"
  return {
    async classify(input, signal) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      if (signal.aborted) controller.abort()
      else signal.addEventListener("abort", abort, { once: true })
      const timer = setTimeout(abort, TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(opts.apiKey ? { "x-api-key": opts.apiKey } : {}),
          },
          body: JSON.stringify({
            transcript: input.transcript,
            action: input.action,
            policy: input.policy,
          }),
        })
        if (!res.ok) {
          return {
            shouldBlock: true,
            unavailable: true,
            reason: `OG classifier service returned ${res.status}`,
            model: opts.label,
          }
        }
        const d = (await res.json()) as {
          should_block?: unknown
          reason?: unknown
          unavailable?: unknown
          model?: unknown
        }
        if (typeof d.should_block !== "boolean") {
          return {
            shouldBlock: true,
            unavailable: true,
            reason: "OG classifier service returned a malformed response",
            model: opts.label,
          }
        }
        return {
          shouldBlock: d.should_block,
          reason: typeof d.reason === "string" ? d.reason : undefined,
          unavailable: d.unavailable === true,
          model: typeof d.model === "string" ? d.model : opts.label,
        }
      } catch (e) {
        return {
          shouldBlock: true,
          unavailable: true,
          reason: e instanceof Error ? e.message : "OG classifier service unavailable",
          model: opts.label,
        }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
      }
    },
  }
}
