// Normalised, provenance-tagged view of how much serving capacity a provider
// actually has free.
//
// The motivating measurement (2026-07-26, one instant, three hosts):
//
//   z4       gpu_util 85%  inference={busy:false, in_flight:0, slots_total:1}
//   rocky    gpu_util 99%  inference={busy:true,  in_flight:1, slots_total:1}
//   proxmox  gpu_util  3%  inference={busy:false, in_flight:0, slots_total:1}
//
// z4 was completely free — 48GB, model resident, nothing queued — while reading
// 85% utilised, because an AMD host pinned at ttl 0 never unloads and idle
// weights read high. rocky's 99% happened to agree with reality, which is what
// makes utilisation a treacherous proxy: it is right often enough to look sound.
// Utilisation says whether silicon is doing something; it cannot separate
// "serving a request" from "holding weights". Only the server knows its queue.
//
// Hence `signal`: a consumer must be able to tell a measured queue depth from a
// guess, and weight its decisions accordingly.
import type { ResourceSnapshot } from "./llama-skein/gen/types.gen"

export type CapacitySignal = "exact" | "inferred"

export type CapacitySnapshot = {
  provider: string
  baseURL: string
  // False means the probe failed. Distinct from an idle host: an unreachable
  // host must never be reported as having zero requests in flight, or a
  // scheduler will read "not busy" and dispatch into a hole.
  reachable: boolean
  // Absent when unreachable — there is no signal to characterise.
  signal?: CapacitySignal
  slotsTotal?: number
  inFlight?: number
  // Advisory when `signal` is "inferred".
  freeSlots?: number
  busy?: boolean
  loadedModel?: string
  probedAt: number
  ageMs: number
  stale: boolean
}

// A reading older than this cannot be reasoned about — it may predate the host
// going down.
export const DefaultFreshnessMs = 30_000

const GPU_BUSY_PCT = 30
const CPU_BUSY_PCT = 70

function inferredBusy(hw: ResourceSnapshot): boolean {
  const gpuUtil = (hw.gpus ?? []).map((gpu) => gpu.utilization_pct ?? 0)
  if (gpuUtil.length > 0) return Math.max(...gpuUtil) >= GPU_BUSY_PCT
  return (hw.cpu?.util_avg_pct ?? 0) >= CPU_BUSY_PCT
}

// True when the host serves real queue telemetry. `slots_total` alone is enough
// even if `busy` is absent, and vice versa.
function hasExactSignal(hw: ResourceSnapshot): boolean {
  const inf = hw.inference
  if (!inf) return false
  return inf.slots_total !== undefined || inf.busy !== undefined || inf.in_flight !== undefined
}

export function unreachableSnapshot(input: {
  provider: string
  baseURL: string
  probedAt: number
  now?: number
  freshnessMs?: number
}): CapacitySnapshot {
  const now = input.now ?? Date.now()
  const ageMs = Math.max(0, now - input.probedAt)
  return {
    provider: input.provider,
    baseURL: input.baseURL,
    reachable: false,
    probedAt: input.probedAt,
    ageMs,
    stale: ageMs > (input.freshnessMs ?? DefaultFreshnessMs),
  }
}

/**
 * Build a snapshot from a hardware reading.
 *
 * Queue depth always wins over utilisation where both exist — that is the whole
 * point of the module, and the z4 case above is the regression test.
 */
export function capacitySnapshot(input: {
  provider: string
  baseURL: string
  hardware: ResourceSnapshot
  probedAt: number
  now?: number
  freshnessMs?: number
}): CapacitySnapshot {
  const { hardware: hw } = input
  const now = input.now ?? Date.now()
  const ageMs = Math.max(0, now - input.probedAt)
  const base = {
    provider: input.provider,
    baseURL: input.baseURL,
    reachable: true as const,
    loadedModel: hw.loaded_model?.id,
    probedAt: input.probedAt,
    ageMs,
    stale: ageMs > (input.freshnessMs ?? DefaultFreshnessMs),
  }

  if (hasExactSignal(hw)) {
    const inf = hw.inference!
    const inFlight = inf.in_flight ?? 0
    const slotsTotal = inf.slots_total
    if (slotsTotal !== undefined && slotsTotal > 0) {
      const free = Math.max(0, slotsTotal - inFlight)
      return {
        ...base,
        signal: "exact",
        slotsTotal,
        inFlight,
        freeSlots: free,
        // Prefer the host's own verdict; fall back to the arithmetic.
        busy: inf.busy ?? free === 0,
      }
    }
    // Queue telemetry without a slot count: busy is still authoritative.
    const busy = inf.busy ?? inFlight > 0
    return { ...base, signal: "exact", inFlight, freeSlots: busy ? 0 : 1, busy }
  }

  const busy = inferredBusy(hw)
  return { ...base, signal: "inferred", freeSlots: busy ? 0 : 1, busy }
}
