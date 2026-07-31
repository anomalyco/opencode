import type { ResourceSnapshot } from "./llama-skein/gen/types.gen"

/**
 * Model-fit engine: turn a local backend's hardware snapshot into a safe
 * context-window size. Shared by the ctx-size dialog and (future) the
 * auto-adjust-on-overflow recovery path so there is one source of truth for
 * "what context fits this hardware".
 */

export const MIN_WORKFLOW_CTX = 65536
export const MAX_CTX = 262144

export type MemSnapshot = {
  freeMb: number
  totalMb: number
  usedMb: number
  label: string
  modelMb: number // model weights (from file size); 0 if unknown
  kvEstMb: number // kv cache estimate; 0 if unknown
}

/**
 * Recommended ctx_size from real hardware data.
 *
 * `kvEstMb` is the KV cache pre-allocated for the *current* ctx_size, so
 * `currentCtx` must be the backend's **hard n_ctx** (`/api/fit` `configured_ctx`)
 * — not `max_safe_ctx`, which is a prompt budget with the output reserve already
 * subtracted and skews the ratio. `freeMb` is genuinely-available VRAM (already
 * excludes driver/OS overhead). The KV budget is what's allocated now plus what's
 * free to expand into, scaled linearly by current ctx, rounded to 4k, and clamped
 * to the workflow range. Returns null when there isn't enough signal to compute.
 *
 * `maxFitCtx` is llama-skein's `/api/fit` `max_fit_ctx`: the largest hard n_ctx
 * that fits this host's VRAM. It is a hard ceiling — without it this returned
 * ~250k for a model with lots of free VRAM. 0/undefined means "ceiling unknown",
 * in which case nothing is capped.
 */
export function computeRecommendedCtx(m: MemSnapshot, currentCtx: number, maxFitCtx?: number): number | null {
  if (m.kvEstMb <= 0 || currentCtx <= 0) return null
  const kvBudgetMb = m.kvEstMb + m.freeMb
  const tokens = Math.floor((kvBudgetMb * currentCtx) / m.kvEstMb)
  const rounded = Math.floor(tokens / 4096) * 4096
  const clamped = Math.max(MIN_WORKFLOW_CTX, Math.min(MAX_CTX, rounded))
  if (!maxFitCtx || maxFitCtx <= 0) return clamped
  // The ceiling outranks MIN_WORKFLOW_CTX: on a 32k-trained model the workflow
  // floor is simply unreachable, and recommending 64k there writes a --ctx-size
  // the backend cannot load.
  return Math.min(clamped, maxFitCtx)
}

/**
 * True when a ctx_size is above what the model can actually load on this host.
 * `maxFitCtx` 0/undefined means the ceiling is unknown (non-llama-skein backend,
 * VRAM unreadable) — never block on missing data.
 */
export function aboveCeiling(ctx: number, maxFitCtx?: number): boolean {
  return !!maxFitCtx && maxFitCtx > 0 && ctx > maxFitCtx
}

export const PRESETS = [
  4096, 8192, 12288, 16384, 20480, 24576, 28672, 32768, 36864, 40960, 49152, 57344, 65536, 73728, 81920, 98304, 114688,
  131072, 163840, 196608, 262144, 393216, 524288, 786432, 1048576,
]

export function fmtCtxK(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`
  if (n >= 1000) return `${Math.round(n / 1024)}k`
  return `${n}`
}

export function fmtGB(mb: number): string {
  return (mb / 1024).toFixed(1)
}

export function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "")
}

/** Map a llama-skein hardware snapshot to the memory view used for fitting. */
export function extractMem(hw: ResourceSnapshot): MemSnapshot | null {
  const modelMb = hw.loaded_model?.model_mb ?? 0
  const kvEstMb = hw.loaded_model?.kv_estimate_mb ?? 0

  if (hw.vram?.total_mb && hw.vram.total_mb > 100) {
    return {
      freeMb: hw.vram.free_mb ?? 0,
      usedMb: hw.vram.used_mb ?? 0,
      totalMb: hw.vram.total_mb,
      label: "VRAM",
      modelMb,
      kvEstMb,
    }
  }
  if (hw.memory?.total_mb) {
    return {
      freeMb: hw.memory.free_mb ?? 0,
      usedMb: hw.memory.used_mb ?? 0,
      totalMb: hw.memory.total_mb,
      label: hw.memory.type === "unified" ? "Unified" : "RAM",
      modelMb,
      kvEstMb,
    }
  }
  return null
}
