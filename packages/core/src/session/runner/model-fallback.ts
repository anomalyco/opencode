import { Effect, Option } from "effect"
import { Catalog } from "../../catalog"
import { ModelCost } from "../../model-cost"
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
 * exposes, in a stable free-first then release-descending order (FREE-FIRST:
 * recovery lands on zero-cost models before priced ones), so the runner can
 * step down to a different provider/model when a turn fails with a retryable
 * provider error (429 / QuotaExceeded / persistent 5xx) after
 * {@link ProviderRetry.policy} is exhausted — instead of surfacing a `RunError`
 * to the session. The runner cycles through this chain via {@link withFallback};
 * each model keeps its own full retry budget.
 */
export interface FallbackChain {
  readonly primary: ModelV2.Info | undefined
  readonly alternatives: ReadonlyArray<ModelV2.Info>
}

/** Supported models free-first, then release-descending within each cost group (stable, immutable). */
export const order = (available: ReadonlyArray<ModelV2.Info>): ModelV2.Info[] =>
  [...available]
    .filter(SessionRunnerModel.supported)
    .sort(
      (a, b) =>
        Number(ModelCost.isFree(b)) - Number(ModelCost.isFree(a)) || b.time.released - a.time.released,
    )

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

/** `chainFrom` against the live Location catalog. Degrades to an empty chain when
 * no Catalog is in context (single-model behavior is then preserved exactly). */
export const chainFor = Effect.fn("ModelFallback.chainFor")(function* (
  session: SessionSchema.Info,
) {
  const catalog = yield* Effect.serviceOption(Catalog.Service)
  if (Option.isNone(catalog)) return { primary: undefined, alternatives: [] } satisfies FallbackChain
  const available = yield* catalog.value.model.available()
  return chainFrom(session, available)
})

/**
 * Runs `attempt` against the fallback chain, stepping to the next alternative
 * only when the attempt fails with an error accepted by `shouldFallback`.
 * Each model is attempted at most once; when the chain is exhausted the last
 * error surfaces. Typed failures alone are inspected — defects (interrupts,
 * compaction transitions) propagate untouched.
 */
export const withFallback = <A, E>(
  chain: FallbackChain,
  attempt: (preferred: ModelV2.Info | undefined) => Effect.Effect<A, E>,
  shouldFallback: (error: E) => boolean,
): Effect.Effect<A, E> => {
  const next = (preferred: ModelV2.Info | undefined): Effect.Effect<A, E> =>
    attempt(preferred).pipe(
      Effect.catchIf(shouldFallback, (error) =>
        Effect.gen(function* () {
          const alternative = nextAlternative(chain, preferred ?? chain.primary)
          if (alternative === undefined) return yield* Effect.fail(error)
          return yield* next(alternative)
        }),
      ),
    )
  return next(chain.primary)
}

export * as ModelFallback from "./model-fallback"