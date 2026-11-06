import { Context, Effect, Tracer } from "effect"

// ParentSpan is optional, so removing it never takes away a requirement of the effect.
export const withoutParentSpan = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.updateContext(
      (context: Context.Context<R>) => Context.omit(Tracer.ParentSpan)(context) as Context.Context<R>,
    ),
  )
