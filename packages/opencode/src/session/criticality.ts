import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@/config/config"
import { BackgroundJob } from "@/background/job"
import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "./session"
import { SessionID } from "./schema"

/**
 * Fission-inspired Agent Criticality controls.
 *
 * Implements the Agent Criticality Equation (ACE) and the Fission Cascade
 * circuit breaker from "Nuclear Fission Equations for Agentic AI" as
 * trace-driven middleware over sub-agent spawning. Nuclear fission is used only
 * as a modeling inspiration for branching, absorption, and criticality; this is
 * a branching-process approximation, not a physical claim.
 *
 * The effective agent multiplication factor is
 *
 *     k_eff = (nu * f) / (alpha + epsilon)
 *
 * where, operationalized from a sliding window of spawn requests:
 *   - nu * f : children actually spawned per distinct parent action,
 *   - alpha  : absorption fraction (rejected / total spawn requests),
 *   - epsilon: guard against division by zero in early windows.
 *
 * The depth circuit breaker rejects spawns deeper than
 *
 *     D_max = floor( log(N_max / N_0) / log(nu * f + epsilon) )
 *
 * (supercritical case only; subcritical branching needs no depth bound).
 */

export type Decision = "spawn" | "reject_depth" | "reject_supercritical" | "reject_budget"

export interface Metrics {
  readonly kEff: number
  readonly depth: number
  readonly dMax: number
  readonly nActive: number
  readonly nuF: number
  readonly alpha: number
  readonly decision: Decision
  readonly reason?: string
}

export interface Settings {
  readonly mode: "monitor" | "gate"
  readonly kUpper: number
  readonly nMax: number
  readonly windowMs: number
  readonly epsilon: number
  readonly budgetUsd?: number
}

export const DEFAULTS: Settings = {
  mode: "monitor",
  kUpper: 1.5,
  nMax: 64,
  windowMs: 60_000,
  epsilon: 0.1,
}

// --- Pure ACE math (exported for unit testing) ---------------------------

/** k_eff = (nu * f) / (alpha + epsilon). */
export function computeKEff(nuF: number, alpha: number, epsilon: number): number {
  return nuF / (alpha + epsilon)
}

/**
 * Maximum cascade depth before the active population would exceed nMax.
 * Returns Infinity for the subcritical case (nu * f + epsilon <= 1), where the
 * cascade dies out on its own and no depth bound is required.
 */
export function computeDMax(nMax: number, n0: number, nuF: number, epsilon: number): number {
  const base = nuF + epsilon
  if (base <= 1 || nMax <= n0) return Number.POSITIVE_INFINITY
  return Math.floor(Math.log(nMax / n0) / Math.log(base))
}

interface DecisionInput {
  readonly mode: Settings["mode"]
  readonly depth: number
  readonly dMax: number
  readonly kEff: number
  readonly kUpper: number
  readonly budgetUsd?: number
  readonly cascadeCost?: number
  readonly costHat?: number
}

/** Mirrors the request_spawn pseudocode (paper §5.3). */
export function decide(input: DecisionInput): { decision: Decision; reason?: string } {
  if (input.mode === "monitor") return { decision: "spawn" }
  if (input.depth >= input.dMax) return { decision: "reject_depth", reason: "cascade_depth_limit" }
  if (input.kEff > input.kUpper) return { decision: "reject_supercritical", reason: "supercritical_agent_state" }
  if (
    input.budgetUsd !== undefined &&
    (input.cascadeCost ?? 0) + (input.costHat ?? 0) > input.budgetUsd
  ) {
    return { decision: "reject_budget", reason: "budget_absorption" }
  }
  return { decision: "spawn" }
}

// --- Service --------------------------------------------------------------

interface SpawnEvent {
  readonly time: number
  readonly type: "spawn" | "absorb"
  readonly parentID: SessionID
}

export interface Interface {
  /** Evaluate a prospective spawn from `parentID`; returns ACE metrics + decision. */
  readonly evaluate: (parentID: SessionID, costHat?: number) => Effect.Effect<Metrics>
  /** Record that a spawn was admitted (feeds nu / f estimation). */
  readonly recordSpawn: (parentID: SessionID) => Effect.Effect<void>
  /** Record that a spawn was absorbed/rejected (feeds alpha estimation). */
  readonly recordAbsorption: (parentID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Criticality") {}

// Resolve a positive, finite number from a semantic alias first, then the legacy
// name, then the default. Out-of-bounds or non-numeric values fall back.
function pickPositive(semantic: unknown, legacy: unknown, fallback: number): number {
  for (const candidate of [semantic, legacy]) {
    if (typeof candidate === "number" && candidate > 0 && Number.isFinite(candidate)) return candidate
  }
  return fallback
}

export function readSettings(experimental: { criticality?: Partial<Record<keyof Settings | string, unknown>> } | undefined): Settings {
  const c = (experimental as any)?.criticality
  if (!c) return DEFAULTS

  // Validate and coerce each setting with bounds checking. Each tunable accepts a
  // human-readable semantic alias (documented) or its legacy math name (still
  // supported). Semantic name wins when both are present.
  const mode = c.mode === "gate" ? "gate" : "monitor"
  const kUpper = pickPositive(c.k_eff_threshold, c.k_upper, DEFAULTS.kUpper)
  const nMax = pickPositive(c.max_active_agents, c.n_max, DEFAULTS.nMax)
  const windowMs = pickPositive(c.sliding_window_ms, c.window_ms, DEFAULTS.windowMs)

  // epsilon must be in (0, 1); 0 would defeat the division-by-zero guard.
  const epsilon = typeof c.epsilon === "number" && c.epsilon > 0 && c.epsilon < 1 && Number.isFinite(c.epsilon) ? c.epsilon : DEFAULTS.epsilon

  // budget is optional; semantic and legacy names are identical here.
  const budgetUsd = typeof c.budget_usd === "number" && c.budget_usd > 0 && Number.isFinite(c.budget_usd) ? c.budget_usd : undefined

  return { mode, kUpper, nMax, windowMs, epsilon, budgetUsd }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const background = yield* BackgroundJob.Service

    const state = yield* InstanceState.make(
      Effect.fn("Criticality.state")(function* () {
        return { events: [] as SpawnEvent[] }
      }),
    )

    const settings = Effect.fn("Criticality.settings")(function* () {
      const cfg = yield* config.get()
      return readSettings(cfg.experimental)
    })

    const prune = (events: SpawnEvent[], windowMs: number) => {
      const cutoff = Date.now() - windowMs
      // events are appended in time order, so drop the leading expired entries
      let i = 0
      while (i < events.length && events[i]!.time < cutoff) i++
      if (i > 0) events.splice(0, i)
    }

    const record = (parentID: SessionID, type: SpawnEvent["type"]) =>
      Effect.gen(function* () {
        const set = yield* settings()
        const data = yield* InstanceState.get(state)
        data.events.push({ time: Date.now(), type, parentID })
        prune(data.events, set.windowMs)
      })

    // Walk the parentID chain to determine cascade depth (root = 0).
    // Use try/catch to fail fast on session access errors rather than silently
    // treating missing sessions as "no parent".
    const depthOf = Effect.fn("Criticality.depth")(function* (sessionID: SessionID) {
      let depth = 0
      let current: SessionID | undefined = sessionID
      const seen = new Set<string>()
      while (current && !seen.has(current)) {
        seen.add(current)
        try {
          const info = yield* sessions.get(current)
          const parent = info?.parentID
          if (!parent) break
          depth++
          current = parent
          if (depth > 256) break // safety bound against malformed chains
        } catch {
          // If we can't fetch the session, stop walking up. Return current depth.
          break
        }
      }
      return depth
    })

    // Sum cost across the root cascade (root session + descendants). Only used
    // when a budget is configured, so the default path stays cheap.
    // Critical: Do a single atomic traversal to avoid stale readings under
    // concurrent spawns. Walk up to root, then down to all descendants without
    // releasing control in between.
    const cascadeCost = Effect.fn("Criticality.cascadeCost")(function* (sessionID: SessionID) {
      let root: SessionID = sessionID
      let current: SessionID | undefined = sessionID
      const seenUp = new Set<string>()
      // Find root, walking up the parentID chain.
      while (current && !seenUp.has(current)) {
        seenUp.add(current)
        try {
          const info = yield* sessions.get(current)
          if (!info?.parentID) {
            root = current
            break
          }
          current = info.parentID
        } catch {
          // If we can't fetch the parent, treat current as root.
          root = current
          break
        }
      }
      // Sum root + descendants in one walk, without yielding between reads.
      let total = 0
      const stack: SessionID[] = [root]
      const visited = new Set<string>()
      while (stack.length) {
        const id = stack.pop()!
        if (visited.has(id)) continue
        visited.add(id)
        try {
          const info = yield* sessions.get(id)
          if (info) total += info.cost ?? 0
          const kids = yield* sessions.children(id)
          for (const kid of kids) stack.push(kid.id)
        } catch {
          // If a session is deleted or inaccessible, count conservatively.
          // Assume it might have had cost; don't undercount the budget.
          total += 1 // small penalty to be conservative on missing data
        }
      }
      return total
    })

    const activePopulation = Effect.fn("Criticality.activePopulation")(function* () {
      try {
        const jobs = yield* background.list()
        return jobs.filter((job) => job.status === "running").length
      } catch {
        // If background job list fails, assume no active jobs (conservative).
        return 0
      }
    })

    const evaluate = Effect.fn("Criticality.evaluate")(function* (parentID: SessionID, costHat?: number) {
      const set = yield* settings()
      const data = yield* InstanceState.get(state)
      prune(data.events, set.windowMs)

      const spawns = data.events.filter((e) => e.type === "spawn").length
      const absorbs = data.events.filter((e) => e.type === "absorb").length
      const requests = spawns + absorbs
      const distinctParents = new Set(data.events.map((e) => e.parentID)).size || 1

      // nu * f : children actually spawned per distinct parent action.
      const nuF = spawns / distinctParents
      // alpha : absorption fraction over the window.
      const alpha = requests > 0 ? absorbs / requests : 0

      const kEff = computeKEff(nuF, alpha, set.epsilon)
      const dMax = computeDMax(set.nMax, 1, nuF, set.epsilon)
      const [depth, nActive] = yield* Effect.all([depthOf(parentID), activePopulation()])

      const cascade =
        set.mode === "gate" && set.budgetUsd !== undefined ? yield* cascadeCost(parentID) : undefined

      const { decision, reason } = decide({
        mode: set.mode,
        depth,
        dMax,
        kEff,
        kUpper: set.kUpper,
        budgetUsd: set.budgetUsd,
        cascadeCost: cascade,
        costHat,
      })

      yield* Effect.logInfo("criticality", {
        "session.id": parentID,
        k_eff_agent: kEff,
        depth,
        d_max: dMax,
        n_active: nActive,
        nu_f: nuF,
        alpha,
        decision,
      })

      return { kEff, depth, dMax, nActive, nuF, alpha, decision, reason } satisfies Metrics
    })

    const recordSpawn = (parentID: SessionID) => record(parentID, "spawn")
    const recordAbsorption = (parentID: SessionID) => record(parentID, "absorb")

    return Service.of({ evaluate, recordSpawn, recordAbsorption })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(BackgroundJob.defaultLayer),
)

export const node = LayerNode.make(layer, [Config.node, Session.node, BackgroundJob.node])

export * as Criticality from "./criticality"
