import * as Log from "@opencode-ai/core/util/log"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { Provider } from "@/provider/provider"
import { createClient, createConfig } from "./llama-skein/gen/client"
import { LlamaSkeinClient } from "./llama-skein/gen/sdk.gen"
import type { FitReport, ModelFit, ResourceSnapshot } from "./llama-skein/gen/types.gen"

const log = Log.create({ service: "local-placement" })

export type Placement = { providerID: ProviderV2.ID; modelID: ModelV2.ID }

// GPU utilization is windowed (~1s) by the drivers, so a host mid-generation
// reads high even between tokens. Loaded-but-idle models read ~0.
const GPU_BUSY_PCT = 30
// Hosts without GPU telemetry (some unified-memory Macs) fall back to CPU.
const CPU_BUSY_PCT = 75

// A burst of spawns probes faster than GPU load materializes on the target,
// so every probe in the burst sees the same "idle" host. Penalize (not
// exclude) hosts placed onto moments ago to spread the burst across the fleet.
const RECENT_PLACEMENT_WINDOW_MS = 20_000
const RECENT_PLACEMENT_PENALTY = 3_000
const recentPlacements = new Map<string, number>()

// Subagent prompts carry a large fixed overhead the caller's prompt text
// doesn't show: the agent's system prompt, tool schemas, and room to generate.
// Bias the context estimate up so we never route to a model that fits the
// visible instruction but not the real request.
const SUBAGENT_BASE_CTX = 8_192

// In-process, per-provider slot reservations. A burst of parallel Task spawns
// each probes before any of their requests lands, so the host's in_flight
// hasn't moved yet and every probe sees the same idle single slot. The
// reservation bridges that TOCTOU window: a pick increments it synchronously
// (no await between reading capacity and reserving), so a concurrent pick in
// the same tick sees the slot taken and routes elsewhere. Released when the
// subagent finishes; a TTL backstop prevents a leaked slot if a caller forgets
// (by then the provider's own in_flight reflects the running request anyway).
const RESERVATION_TTL_MS = 120_000
const reservations = new Map<string, number>()

function reservedFor(id: string): number {
  return reservations.get(id) ?? 0
}

function reserve(id: string): () => void {
  reservations.set(id, reservedFor(id) + 1)
  let released = false
  const doRelease = () => {
    if (released) return
    released = true
    reservations.set(id, Math.max(0, reservedFor(id) - 1))
  }
  const timer = setTimeout(doRelease, RESERVATION_TTL_MS)
  ;(timer as { unref?: () => void }).unref?.()
  return () => {
    clearTimeout(timer)
    doRelease()
  }
}

// Free serving slots on a host, accounting for reservations held by concurrent
// picks. Uses llama-skein's exact slot telemetry when present; older hosts
// without it fall back to a single slot inferred from busyness.
export function freeSlots(hw: ResourceSnapshot, reserved: number): number {
  const inf = hw.inference
  if (inf?.slots_total !== undefined && inf.slots_total > 0) {
    return inf.slots_total - (inf.in_flight ?? 0) - reserved
  }
  return (isBusy(hw) ? 0 : 1) - reserved
}

// Estimated context a subagent needs: the visible prompt plus the fixed
// system-prompt/tools/generation overhead. Used as a hard eligibility filter.
export function estimateRequiredCtx(promptText?: string): number {
  const promptTokens = promptText ? Math.ceil(promptText.length / 4) : 0
  return SUBAGENT_BASE_CTX + promptTokens
}

const FIT_RANK: Record<NonNullable<ModelFit["fit_level"]>, number> = {
  perfect: 4,
  good: 3,
  tight: 2,
  marginal: 1,
  no: 0,
  // VRAM couldn't be read — we can't tell if the model fits, so don't place on it.
  unknown: 0,
}

function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "")
}

export function baseURLOf(info: Provider.Info): string | undefined {
  const url = info.options?.["baseURL"]
  return typeof url === "string" && url.length > 0 ? url : undefined
}

function isBusy(hw: ResourceSnapshot): boolean {
  // Exact signal when the host reports it (llama-skein >= inference block):
  // every serving slot occupied means a new request queues, regardless of
  // what the utilization meters happen to read this instant.
  if (hw.inference?.busy !== undefined) return hw.inference.busy
  // Fallback for older hosts: windowed utilization, inferred.
  const gpuUtil = (hw.gpus ?? []).map((gpu) => gpu.utilization_pct ?? 0)
  if (gpuUtil.length > 0) return Math.max(...gpuUtil) >= GPU_BUSY_PCT
  return (hw.cpu?.util_avg_pct ?? 0) >= CPU_BUSY_PCT
}

export type Probe = {
  providerID: ProviderV2.ID
  hardware: ResourceSnapshot
  fit: FitReport
}

async function probe(providerID: ProviderV2.ID, baseURL: string, signal: AbortSignal): Promise<Probe | null> {
  const llama = new LlamaSkeinClient({
    client: createClient(createConfig({ baseUrl: normalizeBaseURL(baseURL) })),
    key: `placement:${providerID}`,
  })
  const [hardware, fit] = await Promise.all([
    llama
      .getHardware({ signal })
      .then((res) => res.data ?? null)
      .catch(() => null),
    llama
      .getFitReport({ signal })
      .then((res) => res.data ?? null)
      .catch(() => null),
  ])
  // Both signals are required: hardware to judge busyness, fit to judge which
  // model can actually serve a subagent. A plain llama-swap host without the
  // llama-skein API yields nulls and is skipped — capacity we can't see is
  // capacity we don't schedule on.
  if (!hardware || !fit) return null
  return { providerID, hardware, fit }
}

export function bestModel(input: {
  probe: Probe
  info: Provider.Info
  parentModelID: string
  requiredCtx: number
  allowedModels?: readonly string[]
}): { modelID: ModelV2.ID; score: number } | null {
  const loadedID = input.probe.hardware.loaded_model?.id
  let best: { modelID: ModelV2.ID; score: number } | null = null
  for (const fit of input.probe.fit.models) {
    const model = input.info.models[fit.model]
    if (!model) continue // not registered with opencode — can't be prompted
    // Discovered local models default toolcall to true, so this filter alone
    // can't be trusted — the allowlist below is the real vetting mechanism.
    if (!model.capabilities.toolcall) continue
    // Curated list of models proven to handle subagent tool calls. Anything
    // else may be loaded and fast yet flub tool-call JSON, wasting the whole
    // task. The parent's own model is always trusted — the user picked it.
    if (input.allowedModels?.length && fit.model !== input.parentModelID && !input.allowedModels.includes(fit.model))
      continue
    // Hard context filter. A model whose usable context (max_safe_ctx) can't
    // hold the subagent prompt will 413 or silently truncate it — never pick
    // it, regardless of how well it fits VRAM or how fast it is. This is the
    // fix for the "always picks m5" bias: a model pinned to a tiny ctx
    // (max_safe_ctx 0) still scored 'perfect' on VRAM fit and won every time.
    // Context adequacy is eligibility, not a score term.
    if (fit.max_safe_ctx <= 0 || fit.max_safe_ctx < input.requiredCtx) continue
    const rank = FIT_RANK[fit.fit_level] ?? 0
    if (rank === 0) continue
    const score =
      rank * 1_000 +
      // Same model as the parent: proven behavior beats avoiding a swap — a
      // 30s model load costs less than a subagent that derails on tool calls.
      (fit.model === input.parentModelID ? 5_000 : 0) +
      // Already resident: skips the multi-second llama-swap load.
      (fit.model === loadedID ? 2_000 : 0) +
      Math.min(fit.est_tokens_per_sec ?? 0, 500)
    if (!best || score > best.score) best = { modelID: model.id, score }
  }
  return best
}

/**
 * Pick an idle local llama-skein provider for a subagent, so it runs in true
 * parallel instead of queueing behind the parent on the same (often
 * single-slot) llama.cpp server. Returns null when nothing better than
 * inheriting the parent's provider exists — callers must treat null as
 * "inherit", never as an error.
 */
export async function pick(input: {
  parent: Placement
  providers: Record<string, Provider.Info>
  allowedModels?: readonly string[]
  promptText?: string
  requiredCtx?: number
  timeoutMs?: number
}): Promise<(Placement & { release: () => void }) | null> {
  try {
    const requiredCtx = input.requiredCtx ?? estimateRequiredCtx(input.promptText)
    const parentInfo = input.providers[input.parent.providerID]
    // Only reroute when the parent itself runs locally: a cloud parent has no
    // queue problem, and silently downgrading it to a local model would be a
    // quality surprise.
    if (!parentInfo || !baseURLOf(parentInfo)) return null

    const candidates = Object.values(input.providers)
      .filter((info) => info.id !== input.parent.providerID)
      .flatMap((info) => {
        const baseURL = baseURLOf(info)
        return baseURL ? [{ info, baseURL }] : []
      })
    if (candidates.length === 0) return null

    const aborter = new AbortController()
    const timer = setTimeout(() => aborter.abort(), input.timeoutMs ?? 1_500)
    const probes = await Promise.all(
      candidates.map((candidate) => probe(candidate.info.id, candidate.baseURL, aborter.signal)),
    ).finally(() => clearTimeout(timer))

    let best: { placement: Placement; score: number } | null = null
    for (let i = 0; i < candidates.length; i++) {
      const result = probes[i]
      if (!result) continue
      // Slot-aware eligibility: skip a host with no free serving slot, counting
      // reservations held by concurrent picks so two parallel subagents never
      // both book the same single-slot (--parallel 1) provider.
      if (freeSlots(result.hardware, reservedFor(result.providerID)) <= 0) continue
      const model = bestModel({
        probe: result,
        info: candidates[i].info,
        parentModelID: input.parent.modelID,
        requiredCtx,
        allowedModels: input.allowedModels,
      })
      if (!model) continue
      const freeMb = result.fit.vram_free_mb ?? result.hardware.vram?.free_mb ?? 0
      const placedAt = recentPlacements.get(result.providerID)
      const recent = placedAt !== undefined && Date.now() - placedAt < RECENT_PLACEMENT_WINDOW_MS
      const score =
        model.score + Math.min(freeMb, 65_536) / 1_000 - (recent ? RECENT_PLACEMENT_PENALTY : 0)
      if (!best || score > best.score) {
        best = { placement: { providerID: result.providerID, modelID: model.modelID }, score }
      }
    }

    if (best) {
      // Reserve synchronously, before any await, so a concurrent pick in the
      // same tick sees the slot taken. Held until the caller releases (or the
      // TTL backstop fires).
      const release = reserve(best.placement.providerID)
      recentPlacements.set(best.placement.providerID, Date.now())
      log.info("placed subagent on idle local provider", {
        provider: best.placement.providerID,
        model: best.placement.modelID,
        parent: input.parent.providerID,
        requiredCtx,
        probed: candidates.length,
      })
      return { ...best.placement, release }
    }
    log.info("no idle local provider, inheriting parent", {
      parent: input.parent.providerID,
      probed: candidates.length,
    })
    return null
  } catch (err) {
    // Placement is an optimization; a failure here must never break the spawn.
    log.error("placement failed, inheriting parent", { error: String(err) })
    return null
  }
}

export * as LocalPlacement from "./placement"
