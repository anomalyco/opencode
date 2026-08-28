import type { Effect, Scope } from "effect"
import type { Registration } from "./registration.js"

export interface InvokeHooks {
  readonly register: (
    name: string,
    handle: (input: unknown) => Effect.Effect<unknown>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}
