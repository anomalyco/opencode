import type { Effect, Scope } from "effect"

export type Transform<Draft> = (draft: Draft) => Effect.Effect<void> | void

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface Transformable<Draft> {
  transform(callback: Transform<Draft>): Effect.Effect<Registration, never, Scope.Scope>
  rebuild(): Effect.Effect<void>
}

export interface Hookable<Hooks> {
  hook<Name extends keyof Hooks>(name: Name, callback: Hooks[Name]): Effect.Effect<Registration, never, Scope.Scope>
}
