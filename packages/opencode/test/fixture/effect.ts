import { test } from "bun:test"
import { Effect, Layer } from "effect"

export const testEffect = <R, E>(layer: Layer.Layer<R, E, never>) => ({
  effect: <A, E2>(name: string, value: Effect.Effect<A, E2, R>) =>
    test(name, () => Effect.runPromise(value.pipe(Effect.provide(layer)))),
})
