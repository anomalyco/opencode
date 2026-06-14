import { LayerNode } from "@daemon-protocol/core/effect/layer-node"
import { Config } from "@/config/config"
import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"

/**
 * Always-on budget & runaway guard.
 *
 * Independent of the multi-agent ACE criticality layer: this applies to *every*
 * session. As the session's cumulative cost approaches a configured cap it warns
 * the model once per threshold (so it can wrap up), and — by default — stops the
 * session gracefully before the cap is exceeded rather than reporting the overage
 * after the fact.
 *
 * Config lives at `experimental.budget`:
 *   { usd: 5, warn_at: [0.5, 0.8], on_exceed: "stop" }
 */

export type OnExceed = "stop" | "warn"

export interface Settings {
  readonly usd?: number
  readonly warnAt: number[]
  readonly onExceed: OnExceed
}

const DEFAULT_WARN_AT = [0.5, 0.8]

export interface CheckResult {
  /** Whether a budget is configured at all. */
  readonly enabled: boolean
  /** spend / cap, in [0, ∞). 0 when no budget. */
  readonly fraction: number
  /** Configured cap, if any. */
  readonly usd?: number
  /** Current cumulative spend. */
  readonly spent: number
  /** Whether spend has reached/exceeded the cap. */
  readonly exceeded: boolean
  /** Thresholds (fractions) crossed for the first time on this check. */
  readonly newlyCrossed: number[]
  /** Configured behavior when the cap is exceeded. */
  readonly onExceed: OnExceed
}

export interface Interface {
  /** Evaluate the session's spend against its configured budget. */
  readonly check: (sessionID: SessionID, spentUsd: number) => Effect.Effect<CheckResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Budget") {}

export function readSettings(experimental: unknown): Settings {
  const b = (experimental as { budget?: Record<string, unknown> } | undefined)?.budget
  if (!b) return { warnAt: DEFAULT_WARN_AT, onExceed: "stop" }
  const usd = typeof b.usd === "number" && b.usd > 0 && Number.isFinite(b.usd) ? b.usd : undefined
  const warnAt = Array.isArray(b.warn_at)
    ? b.warn_at.filter((x: unknown): x is number => typeof x === "number" && x > 0 && x < 1).sort((a: number, z: number) => a - z)
    : DEFAULT_WARN_AT
  const onExceed: OnExceed = b.on_exceed === "warn" ? "warn" : "stop"
  return { usd, warnAt: warnAt.length ? warnAt : DEFAULT_WARN_AT, onExceed }
}

/** Build the one-time warning text injected at a crossed threshold. */
export function warningText(spent: number, cap: number, pct: number): string {
  return [
    `<budget-warning>`,
    `This session has spent $${spent.toFixed(2)} of its $${cap.toFixed(2)} budget (${Math.round(pct * 100)}%).`,
    `Start wrapping up: prioritize finishing the current task, avoid new tangents or large tool sweeps,`,
    `and summarize remaining work instead of attempting it once the budget is reached.`,
    `</budget-warning>`,
  ].join("\n")
}

/** Build the message shown when the budget is exceeded and on_exceed is "stop". */
export function stopText(spent: number, cap: number): string {
  return `Session stopped: budget of $${cap.toFixed(2)} reached (spent $${spent.toFixed(2)}). Raise experimental.budget.usd to continue, or start a new session.`
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    // Per-session set of warning fractions already fired, so each warns once.
    const state = yield* InstanceState.make(
      Effect.fn("Budget.state")(function* () {
        return { fired: new Map<string, Set<number>>() }
      }),
    )

    const check = Effect.fn("Budget.check")(function* (sessionID: SessionID, spentUsd: number) {
      const cfg = yield* config.get()
      const set = readSettings(cfg.experimental)
      if (set.usd === undefined) {
        return {
          enabled: false,
          fraction: 0,
          spent: spentUsd,
          exceeded: false,
          newlyCrossed: [],
          onExceed: set.onExceed,
        } satisfies CheckResult
      }

      const fraction = spentUsd / set.usd
      const exceeded = spentUsd >= set.usd

      const data = yield* InstanceState.get(state)
      let fired = data.fired.get(sessionID)
      if (!fired) {
        fired = new Set<number>()
        data.fired.set(sessionID, fired)
      }
      const newlyCrossed: number[] = []
      for (const threshold of set.warnAt) {
        if (fraction >= threshold && !fired.has(threshold)) {
          fired.add(threshold)
          newlyCrossed.push(threshold)
        }
      }

      return {
        enabled: true,
        fraction,
        usd: set.usd,
        spent: spentUsd,
        exceeded,
        newlyCrossed,
        onExceed: set.onExceed,
      } satisfies CheckResult
    })

    return Service.of({ check })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export const node = LayerNode.make(layer, [Config.node])

export * as Budget from "./budget"
