/** OpenCode adapter: LLM calls via experimental.generate.text (decision D2). */
import { Effect } from "effect"
import type { LlmPort, LlmRequest, LlmResponse } from "../../core/ports"
import type { Usage } from "../../core/types"

export interface GenerateHost {
  experimental: {
    generate: {
      text: (input: { prompt: string; model?: { providerID: string; id: string } }) => Effect.Effect<{ text: string }, unknown>
    }
  }
}

export interface ModelRef { providerID: string; id: string }

export function parseModelRef(s: string | null | undefined): ModelRef | null {
  if (!s) return null
  const idx = s.indexOf("/")
  if (idx <= 0) return null
  return { providerID: s.slice(0, idx), id: s.slice(idx + 1) }
}

export interface LlmCallInfo {
  purpose: "extraction" | "consolidation"
  ok: boolean
  model?: string
  latencyMs: number
  /** null = usage unavailable from the provider. */
  usage: Usage | null
  error?: string
}

export interface CreateLlmOpts {
  host: GenerateHost
  resolveModel: () => ModelRef | null
  /** Observability hook: invoked once per complete() attempt (the `llm_call` metric). */
  onCall?: (info: LlmCallInfo) => void
}

export function createLlm(opts: CreateLlmOpts): LlmPort {
  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const t0 = Date.now()
      const model = parseModelRef(req.model ?? null) ?? opts.resolveModel()
      const modelLabel = model ? `${model.providerID}/${model.id}` : "session-default"
      const prompt = `${req.system}\n\n${req.user}`
      const eff = opts.host.experimental.generate.text({ prompt, ...(model ? { model } : {}) })
      let timer: ReturnType<typeof setTimeout> | null = null
      try {
        const result = await Promise.race([
          Effect.runPromise(eff as Effect.Effect<{ text: string }, unknown>).catch((error: unknown) => {
            // A failed generate call (model resolution, provider auth, quota)
            // is not a JSON problem: tag it so extraction reports the real
            // cause instead of "invalid-json".
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`llm-error: ${message}`)
          }),
          new Promise<never>((_, reject) => {
            // Cleared in finally: an uncleared pending timer would keep
            // short-lived `opencode run` processes alive until the timeout.
            timer = setTimeout(() => reject(new Error("extraction timeout")), req.timeoutMs)
          }),
        ])
        const latencyMs = Date.now() - t0
        opts.onCall?.({ purpose: req.purpose, ok: true, model: modelLabel, latencyMs, usage: null })
        return {
          text: (result as { text: string }).text,
          usage: null,
          model: modelLabel,
          latencyMs,
        }
      } catch (error) {
        const latencyMs = Date.now() - t0
        const message = error instanceof Error ? error.message : String(error)
        opts.onCall?.({ purpose: req.purpose, ok: false, model: modelLabel, latencyMs, usage: null, error: message.slice(0, 300) })
        throw error
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
  }
}
