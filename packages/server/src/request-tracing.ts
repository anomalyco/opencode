import { Context, Effect, Tracer } from "effect"

/** Removes ambient tracing state; the wrapped effect must not require ParentSpan as a service. */
export const withoutParentSpan = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.updateContext(
      (context: Context.Context<R>) => Context.omit(Tracer.ParentSpan)(context) as Context.Context<R>,
    ),
  )
