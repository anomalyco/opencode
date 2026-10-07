import { Effect } from "effect"
import { Catalog } from "../../catalog"
import { ModelV2 } from "../../model"
import { SessionSchema } from "../schema"
import { SessionRunnerModel } from "./model"

/**
 * Ordered fallback chain for a Session's provider turns, drawn from the current
 * Location's Catalog.
 *
 * `primary` mirrors the model {@link SessionRunnerModel.resolve} selects (the
 * Session choice, or the catalog default / first supported model when none is
 * chosen). `alternatives` lists every *other* supported model the Location
 * exposes, in a stable release-descending order, so the runner can step down to a
 * different provider/model when a turn fails with a retryable provider error
 * (429 / QuotaExceeded / persistent 5xx) after {@link ProviderRetry.policy} is
 * exhausted — instead of surfacing a `RunError` to the session.
 *
 * This is the catalog side only; wiring the runner to cycle through it on retry
 * exhaustion is a follow-up reviewed under the interrupt-finality invariant.
 */
export interface FallbackChain {
  readonly primary: ModelV2.Info | undefined
  readonly alternatives: ReadonlyArray<ModelV2.Info>
}

/** Supported models release-descending (stable, immutable). */
export const order = (available: ReadonlyArray<ModelV2.Info>): ModelV2.Info[] =>
  [...available].filter(SessionRunnerModel.supported).sort((a, b) => b.time.released - a.time.released)

/** Builds the fallback chain from a Session's catalog snapshot. */
export const chainFrom = (
  session: SessionSchema.Info,
  available: ReadonlyArray<ModelV2.Info>,
): FallbackChain => {
  const ordered = order(available)
  const selected = session.model
  const primary = selected
    ? ordered.find((m) => m.providerID === selected.providerID && m.id === selected.id)
    : ordered[0]
  return { primary, alternatives: ordered.filter((m) => m !== primary) }
}

/**
 * Returns the next fallback model after `previous` (the one just attempted), or
 * `undefined` when the chain is exhausted. `previous` of `undefined`/`primary`
 * yields the first alternative; omitting it returns the primary.
 */
export const nextAlternative = (
  chain: FallbackChain,
  previous: ModelV2.Info | undefined,
): ModelV2.Info | undefined => {
  const ordered: ModelV2.Info[] = chain.primary ? [chain.primary, ...chain.alternatives] : [...chain.alternatives]
  const index = previous ? ordered.indexOf(previous) : -1
  return index >= 0 ? ordered[index + 1] : undefined
}

/** `chainFrom` against the live Location catalog. */
export const chainFor = Effect.fn("ModelFallback.chainFor")(function* (
  session: SessionSchema.Info,
) {
  const catalog = yield* Catalog.Service
  const available = yield* catalog.model.available()
  return chainFrom(session, available)
})

export * as ModelFallback from "./model-fallback"