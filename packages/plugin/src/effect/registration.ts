import type { Effect, Scope } from "effect"

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export type Hooks<Spec, Failure = never> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]) => Effect.Effect<void, Failure>,
) => Effect.Effect<Registration, never, Scope.Scope>

export type Transform<Input> = (callback: (input: Input) => void) => Effect.Effect<Registration, never, Scope.Scope>
