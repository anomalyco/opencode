import type { ModelV2 } from "@opencode-ai/core/model"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { Provider } from "@/provider/provider"
import { createClient, createConfig } from "./llama-skein/gen/client"
import { LlamaSkeinClient } from "./llama-skein/gen/sdk.gen"
import type { FitReport, ModelFit, ResourceSnapshot } from "./llama-skein/gen/types.gen"
import { syncLogInfo, syncLogError } from "@/util/sync-log"

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

// A model placed hybrid GPU + system-RAM runs its expert layers out of host
// memory, and host bandwidth — not the GPU — then paces every token. Measured
// on z4: the same host serves a full-GPU model at 70 tok/s and a
// cpu-bound-hybrid one at 0.81 tok/s. Both report themselves ready, and a
// hybrid model earns a perfectly respectable fit_level ("tight" in that run),
// so without this it wins on residency alone (+100_000) and a subagent
// silently lands on a model ~90x slower.
//
// This is a penalty, not a filter: a model that only runs hybrid is the only
// way to run that model at all, so it stays selectable when nothing better is
// eligible. The penalty only has to outweigh the residency tier, so a loaded
// hybrid model never beats an unloaded GPU-resident one.
const HOST_PACED_PENALTY = 200_000

function isHostPaced(fit: ModelFit): boolean {
  const perf = fit.placement?.perf_class
  return perf === "cpu-bound-hybrid" || perf === "cpu-only"
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
      // Already resident: an absolute tier, not a bonus — same rule as skein.
      // Swapping models on a host mid-session evicts what the user (or skein)
      // deliberately keeps loaded and costs a multi-second reload both ways.
      // An eligible resident model always beats anything that needs a load;
      // eligibility (allowlist, ctx, fit) is still enforced by the filters
      // above, so an unvetted or too-small resident model never wins by
      // residency alone.
      (fit.model === loadedID ? 100_000 : 0) +
      // Among models that would need a load, prefer the parent's own model:
      // proven behavior beats an arbitrary pick.
      (fit.model === input.parentModelID ? 5_000 : 0) +
      Math.min(fit.est_tokens_per_sec ?? 0, 500) -
      // Host-bandwidth-paced placements rank below every GPU-resident
      // candidate, residency tier included — see HOST_PACED_PENALTY.
      (isHostPaced(fit) ? HOST_PACED_PENALTY : 0)
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
 *
 * The result separates `placement` (pure data, safe to embed in part/session
 * metadata) from `release` (the slot-reservation handle). They must never be
 * merged into one object: part metadata is structuredClone()d on every event
 * (Session.updatePart), and a function anywhere inside it throws
 * DataCloneError and kills the subagent spawn.
 */
/**
 * Whether the parent's own provider can absorb a subagent.
 *
 * `pick` returns a bare null for three different reasons — a cloud parent, no
 * local peers, and a failed probe — and the caller cannot tell them apart. It
 * therefore inherits in all three, which on a busy single-slot llama.cpp server
 * queues the subagent invisibly behind its own parent. That request never
 * returns and the session appears hung.
 *
 *   "free"    — inherit is safe (cloud parent, or a local parent with a slot)
 *   "no-slot" — the parent is local and has no free slot; inheriting would queue
 *   "unknown" — the parent is local but unprobeable; the caller decides
 *
 * "unknown" is deliberately not folded into "no-slot": a provider that simply
 * does not serve /api/hardware is not necessarily busy, and hard-failing those
 * would break working setups to fix a different bug.
 */
export type ParentCapacity = "free" | "no-slot" | "unknown"

/** Pure decision half of parentCapacity, split out so it is unit-testable. */
export function capacityFromProbe(result: Probe | undefined | null, reserved: number): ParentCapacity {
  if (!result) return "unknown"
  return freeSlots(result.hardware, reserved) > 0 ? "free" : "no-slot"
}

export async function parentCapacity(input: {
  parent: Placement
  providers: Record<string, Provider.Info>
  timeoutMs?: number
}): Promise<ParentCapacity> {
  const parentInfo = input.providers[input.parent.providerID]
  if (!parentInfo) return "unknown"
  const baseURL = baseURLOf(parentInfo)
  // A cloud parent has no slot model and no queue problem.
  if (!baseURL) return "free"

  const aborter = new AbortController()
  const timer = setTimeout(() => aborter.abort(), input.timeoutMs ?? 1_500)
  const result = await probe(parentInfo.id, baseURL, aborter.signal).finally(() => clearTimeout(timer))
  return capacityFromProbe(result, reservedFor(parentInfo.id))
}

/**
 * Whether placement should be attempted at all.
 *
 * Placement normally requires a LOCAL parent: a cloud parent has no queue
 * problem, and moving its subagents onto local weights unasked silently
 * downgrades a model the user deliberately chose. Two things count as asking —
 * an explicit target (this delegation, this host) and a role that declares
 * where it wants to run (every delegation to this role). Either one makes the
 * downgrade intended, which is the entire mechanism.
 */
export function shouldAttemptPlacement(input: {
  parentIsLocal: boolean
  target?: string
  prefer?: "inherit" | "local" | readonly string[]
}): boolean {
  if (input.target) return true
  // An empty list names nothing, so it authorizes nothing — otherwise a typo'd
  // `placement: []` would quietly move a cloud parent's subagents onto local
  // weights, which is the exact surprise the guard exists to prevent.
  const declared = input.prefer === "local" || (Array.isArray(input.prefer) && input.prefer.length > 0)
  if (declared) return true
  return input.parentIsLocal
}

/**
 * Score contribution for a role's preferred hosts.
 *
 * Ranking, never filtering — that is what makes a preference unable to fail a
 * run. A named host that is unreachable, busy, or gone simply scores 0 and the
 * other candidates remain eligible. Earlier in the list outranks later, and any
 * named host outranks any unnamed one.
 *
 * The step is deliberately BELOW `HOST_PACED_PENALTY` (200_000) and above
 * `RECENT_PLACEMENT_PENALTY` (3_000) and the free-VRAM term (~65). So naming a
 * host wins every ordinary tie, and still loses to "that host's only resident
 * model runs out of system RAM" — measured at 0.81 tok/s against 70 on the same
 * machine. Wanting work on a particular host is a preference; landing on a model
 * ~90x slower is not what anyone means by it.
 */
const HOST_PREFERENCE_STEP = 10_000

export function hostRankFor(prefer: "inherit" | "local" | readonly string[] | undefined, providerID: string): number {
  if (!Array.isArray(prefer)) return 0
  const index = prefer.indexOf(providerID)
  return index === -1 ? 0 : (prefer.length - index) * HOST_PREFERENCE_STEP
}

export async function pick(input: {
  parent: Placement
  providers: Record<string, Provider.Info>
  allowedModels?: readonly string[]
  promptText?: string
  requiredCtx?: number
  timeoutMs?: number
  /** Explicitly requested provider id — restrict placement to this host only. */
  target?: string
  /**
   * The role's declared placement (`Agent.Info.placement`).
   *
   * Absent behaves as today. Present is the AUTHORIZATION the non-local-parent
   * guard below was missing: a cloud parent's subagents are not placed locally
   * unless the role has said that is what it wants, because doing it unasked
   * silently downgrades a model the user deliberately chose.
   *
   * A host list is a preference, never a requirement — see the ordering below.
   */
  prefer?: "inherit" | "local" | readonly string[]
}): Promise<{ placement: Placement; release: () => void } | null> {
  try {
    const requiredCtx = input.requiredCtx ?? estimateRequiredCtx(input.promptText)
    const parentInfo = input.providers[input.parent.providerID]
    // Only reroute when the parent itself runs locally: a cloud parent has no
    // queue problem, and silently downgrading it to a local model would be a
    // quality surprise. Two exemptions, both of them someone asking for it:
    // an explicit target (this delegation, this host), and a role that declares
    // where it wants to run (every delegation to this role). Without one of
    // those the guard stands, so nothing existing changes.
    if (
      !shouldAttemptPlacement({
        parentIsLocal: !!parentInfo && !!baseURLOf(parentInfo),
        target: input.target,
        prefer: input.prefer,
      })
    )
      return null

    const candidates = Object.values(input.providers)
      .filter((info) => (input.target ? info.id === input.target : info.id !== input.parent.providerID))
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

    // A declared host list orders candidates; it does not filter them. Ranking
    // rather than filtering is what makes the preference unable to fail a run:
    // if every named host is unreachable or busy, the remaining candidates are
    // still there to be picked, and pick() falls through to inherit only when
    // genuinely nothing is eligible.
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
      // hostRank dominates every other term when the role named hosts, so the
      // preference is honoured among ELIGIBLE candidates — eligibility (slot,
      // context, fit, allowlist) is still enforced above and a named host that
      // fails it simply never gets here.
      const score =
        hostRankFor(input.prefer, result.providerID) +
        model.score +
        Math.min(freeMb, 65_536) / 1_000 -
        (recent ? RECENT_PLACEMENT_PENALTY : 0)
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
      syncLogInfo("local-placement", "placed subagent on idle local provider", {
        provider: best.placement.providerID,
        model: best.placement.modelID,
        parent: input.parent.providerID,
        requiredCtx,
        probed: candidates.length,
      })
      return { placement: best.placement, release }
    }
    syncLogInfo("local-placement", "no idle local provider, inheriting parent", {
      parent: input.parent.providerID,
      probed: candidates.length,
    })
    return null
  } catch (err) {
    // Placement is an optimization; a failure here must never break the spawn.
    syncLogError("local-placement", "placement failed, inheriting parent", { error: String(err) })
    return null
  }
}

export * as LocalPlacement from "./placement"
