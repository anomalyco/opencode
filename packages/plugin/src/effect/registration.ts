import type { Effect, Scope } from "effect"

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface ModelHookOptions {
  /** Limits the hook to one provider. Unscoped hooks apply to every provider. */
  readonly providerID?: string
}

export type Hooks<Spec, Failures extends Record<keyof Spec, unknown> = Record<keyof Spec, never>> = <
  Name extends keyof Spec,
>(
  name: Name,
  callback: (input: Spec[Name]) => Effect.Effect<void, Failures[Name]>,
) => Effect.Effect<Registration, never, Scope.Scope>

export type ModelHooks<Spec, Failures extends Record<keyof Spec, unknown> = Record<keyof Spec, never>> = <
  Name extends keyof Spec,
>(
  name: Name,
  callback: (input: Spec[Name]) => Effect.Effect<void, Failures[Name]>,
  options?: ModelHookOptions,
) => Effect.Effect<Registration, never, Scope.Scope>

export type Transform<Input> = (callback: (input: Input) => void) => Effect.Effect<Registration, never, Scope.Scope>
