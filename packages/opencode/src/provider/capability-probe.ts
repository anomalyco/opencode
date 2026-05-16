export * as CapabilityProbe from "./capability-probe"

// Runtime detection of OpenAI-compatible server capabilities.
//
// Self-hosted llama.cpp servers expose `<root>/props` with the active chat
// template. Templates that branch on `enable_thinking` (Qwen3 hybrid, Qwen3.5,
// Qwen3.6, QwQ, DeepSeek-R1, GLM-4.6/4.7-thinking, Kimi-K2-Thinking,
// MiniMax-M2, etc.) reject trailing-assistant prefill at runtime with
// `HTTP 400 "Assistant response prefill is incompatible with enable_thinking"`
// (llama.cpp#20861, mastra-ai#15234).
//
// Probing the live template removes the need for per-family name lists in
// models.dev or user config: any server whose template branches on
// `enable_thinking` is detected automatically, including future thinking
// families.
//
// Probe is opt-in by base URL, fail-silent (vLLM/TGI/mistral.rs have no
// `/props` endpoint — they fall through to existing detection), short-timeout
// (1.5s), and cached per process so we hit the network at most once per base
// URL.

export type ProbedCapabilities = {
  prefill?: boolean
  reasoning?: boolean
}

const PROBE_TIMEOUT_MS = 1500
const cache = new Map<string, Promise<ProbedCapabilities>>()

// Normalises a baseURL ("http://host/v1/", "http://host", "http://host/v1")
// to the server root the /props endpoint lives under.
function rootURL(baseURL: string): string {
  return baseURL.replace(/\/v1\/?$/, "").replace(/\/+$/, "")
}

async function probeOnce(baseURL: string): Promise<ProbedCapabilities> {
  const root = rootURL(baseURL)
  if (!root) return {}

  const result: ProbedCapabilities = {}
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const resp = await fetch(`${root}/props`, { signal: ctrl.signal })
    if (!resp.ok) return {}
    const data = (await resp.json()) as { chat_template?: unknown; chat_template_caps?: { supports_preserve_reasoning?: unknown } }

    // Primary signal: the chat template branches on `enable_thinking`. This
    // is the exact condition that produces the prefill-incompatible 400 — it
    // means the template adds `<think>` differently depending on whether
    // generation_prompt is requested, and a trailing-assistant turn (no
    // generation_prompt) lands in the path that conflicts with reasoning.
    if (typeof data.chat_template === "string" && data.chat_template.includes("enable_thinking")) {
      result.prefill = false
      result.reasoning = true
    }

    // Secondary signal: llama.cpp also exposes `supports_preserve_reasoning`
    // on chat_template_caps for thinking templates. This catches a few edge
    // templates that don't use the literal `enable_thinking` keyword.
    if (data.chat_template_caps?.supports_preserve_reasoning === true) {
      result.reasoning = true
    }
  } catch {
    // Probe failed: server has no /props (vLLM/TGI/mistral.rs), is offline,
    // or timed out. Fall back to other detection paths silently.
  } finally {
    clearTimeout(timer)
  }
  return result
}

// Returns probed capabilities for the given openai-compatible base URL.
// Result is cached per base URL for the process lifetime; concurrent callers
// share the same in-flight probe.
export function probe(baseURL: string): Promise<ProbedCapabilities> {
  if (!baseURL) return Promise.resolve({})
  const key = rootURL(baseURL)
  let pending = cache.get(key)
  if (!pending) {
    pending = probeOnce(baseURL)
    cache.set(key, pending)
  }
  return pending
}

// Test-only: clears the in-process probe cache. Used by unit tests so they
// can re-probe without restarting the test runner.
export function _resetCache(): void {
  cache.clear()
}
