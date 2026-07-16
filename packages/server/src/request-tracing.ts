import { Context, Effect, Scope, Tracer } from "effect"

export const withoutParentSpan = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  effect.pipe(
    Effect.updateContext((context: Context.Context<Scope.Scope>) => Context.omit(Tracer.ParentSpan)(context)),
  )
