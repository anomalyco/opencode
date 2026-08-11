import type { Effect, Scope } from "effect"

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

// Every hook event declares its own failure channel next to its payload; most events cannot fail.
export interface HookSpec {
  readonly event: unknown
  readonly failure: unknown
}

export type Hooks<Spec extends Record<keyof Spec, HookSpec>> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name]["event"]) => Effect.Effect<void, Spec[Name]["failure"]>,
) => Effect.Effect<Registration, never, Scope.Scope>

export type Transform<Input> = (callback: (input: Input) => void) => Effect.Effect<Registration, never, Scope.Scope>
