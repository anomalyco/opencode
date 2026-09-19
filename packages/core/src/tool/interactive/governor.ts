export * as InteractiveGovernor from "./governor"

import { Schema } from "effect"
import { Context, Effect, Layer } from "effect"
import { Config } from "../../config"
import { ConfigInteractive } from "../../config/interactive"
import { makeLocationNode } from "../../effect/app-node"
import { DEFAULT_MAX_EXCHANGES, DEFAULT_MAX_JOBS, DEFAULT_QUIET_WINDOW_MS, DEFAULT_JOB_LIFETIME_MS, DEFAULT_WAIT_TIMEOUT_MS, DEFAULT_MAX_SPOOL_BYTES, MAX_JOB_LIFETIME_MS, MAX_WAIT_TIMEOUT_MS } from "./job"

/**
 * Fully resolved `interactive.*` budgets (defaults applied; spec
 * Configuration). Read once per drain/materialization through the Location
 * config service; `maxExchanges`/`maxJobs` also feed the model guidance text.
 */
export interface Budgets {
  readonly maxJobs: number
  readonly maxExchanges: number
  readonly quietWindowMs: number
  readonly waitTimeoutMs: number
  readonly defaultTimeoutMs: number
  readonly maxSpoolBytes: number
}

/**
 * Failed by `assertStartAllowed` when starting another live job would exceed
 * `interactive.max_jobs` (spec R9/R19). `liveJobIDs` lets the model cancel
 * one and retry.
 */
export class TooManyJobsError extends Schema.TaggedErrorClass<TooManyJobsError>()(
  "InteractiveGovernor.TooManyJobsError",
  { liveJobIDs: Schema.Array(Schema.String) },
) {
  override get message() {
    return `Too many live interactive jobs (${this.liveJobIDs.join(", ")}); cancel one with interactive_cancel and retry`
  }
}

/**
 * Verdict of `consumeExchange` (spec R18). `Allowed` carries the remaining
 * budget after the settle; `Exhausted` means the settle would exceed
 * `interactive.max_exchanges` — the tool auto-cancels the job instead
 * (`cancelled`, `reason: "exchanges"`) and returns one terminal result with
 * the full-output path (invariant I8). `cancel` never consumes an exchange.
 */
export type ExchangeDecision = { readonly _tag: "Allowed"; readonly exchangesRemaining: number } | { readonly _tag: "Exhausted" }

/**
 * Budget governor: exchange budget (R18), parallel-job budget (R19/R9), and
 * lifetime/wait deadline resolution (R7/R13/R20). Pure budgeting only — it
 * never touches processes or the spool; enforcement (auto-cancel, reaping)
 * belongs to the job store.
 */
export interface Interface {
  /** Resolve the Location's `interactive.*` config into effective budgets. */
  readonly budgets: () => Effect.Effect<Budgets>
  /**
   * Fail with `TooManyJobsError` when `liveJobIDs.length` is at
   * `interactive.max_jobs`; succeed otherwise. Called before spawn.
   */
  readonly assertStartAllowed: (liveJobIDs: ReadonlyArray<string>) => Effect.Effect<void, TooManyJobsError>
  /**
   * Account one settled `start`/`write`/`wait` result for the job and decide
   * whether the exchange budget is exhausted (spec R18/I8).
   */
  readonly consumeExchange: (jobID: string, exchangesConsumed: number) => Effect.Effect<ExchangeDecision>
  /**
   * Effective job lifetime in ms: the requested value clamped to
   * `MAX_JOB_LIFETIME_MS`, or `interactive.default_timeout_ms` (spec R7/R20).
   */
  readonly lifetimeMs: (requested?: number) => Effect.Effect<number>
  /**
   * Effective `interactive_wait` deadline in ms: the requested value clamped
   * to `MAX_WAIT_TIMEOUT_MS`, or `interactive.wait_timeout_ms` (spec R13).
   */
  readonly waitDeadlineMs: (requested?: number) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/InteractiveGovernor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const interactiveConfig = Effect.fn("InteractiveGovernor.configured")(function* () {
      const entries = yield* config.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[])))
      return Config.latest(entries, "interactive")
    })

    const budgets = Effect.fn("InteractiveGovernor.budgets")(function* () {
      const info = yield* interactiveConfig()
      return {
        maxJobs: info?.max_jobs ?? DEFAULT_MAX_JOBS,
        maxExchanges: info?.max_exchanges ?? DEFAULT_MAX_EXCHANGES,
        quietWindowMs: info?.quiet_window_ms ?? DEFAULT_QUIET_WINDOW_MS,
        waitTimeoutMs: info?.wait_timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS,
        defaultTimeoutMs: info?.default_timeout_ms ?? DEFAULT_JOB_LIFETIME_MS,
        maxSpoolBytes: info?.max_spool_bytes ?? DEFAULT_MAX_SPOOL_BYTES,
      }
    })

    const assertStartAllowed = Effect.fn("InteractiveGovernor.assertStartAllowed")(function* (liveJobIDs: ReadonlyArray<string>) {
      const limit = (yield* budgets()).maxJobs
      if (liveJobIDs.length < limit) return
      return yield* new TooManyJobsError({ liveJobIDs: [...liveJobIDs] })
    })

    const consumeExchange = Effect.fn("InteractiveGovernor.consumeExchange")(function* (jobID: string, exchangesConsumed: number) {
      const max = (yield* budgets()).maxExchanges
      // the settle that would exceed the budget exhausts it instead (spec R18/I8)
      if (exchangesConsumed + 1 > max) return { _tag: "Exhausted" } as const
      return { _tag: "Allowed", exchangesRemaining: max - exchangesConsumed - 1 } as const
    })

    const lifetimeMs = Effect.fn("InteractiveGovernor.lifetimeMs")(function* (requested?: number) {
      const fallback = (yield* budgets()).defaultTimeoutMs
      return Math.min(requested ?? fallback, MAX_JOB_LIFETIME_MS)
    })

    const waitDeadlineMs = Effect.fn("InteractiveGovernor.waitDeadlineMs")(function* (requested?: number) {
      const fallback = (yield* budgets()).waitTimeoutMs
      return Math.min(requested ?? fallback, MAX_WAIT_TIMEOUT_MS)
    })

    return Service.of({ budgets, assertStartAllowed, consumeExchange, lifetimeMs, waitDeadlineMs })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node] })

/** Defaults live here too so config docs and guidance stay in one place. */
export const defaults = {
  max_jobs: DEFAULT_MAX_JOBS,
  max_exchanges: DEFAULT_MAX_EXCHANGES,
  quiet_window_ms: DEFAULT_QUIET_WINDOW_MS,
  wait_timeout_ms: DEFAULT_WAIT_TIMEOUT_MS,
  default_timeout_ms: DEFAULT_JOB_LIFETIME_MS,
  max_spool_bytes: DEFAULT_MAX_SPOOL_BYTES,
} satisfies Record<keyof ConfigInteractive.Info, number>

export { MAX_JOB_LIFETIME_MS, MAX_WAIT_TIMEOUT_MS }
