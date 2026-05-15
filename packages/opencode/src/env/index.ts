import { Context, Effect, Layer } from "effect"

/**
 * Effect-aware wrapper around `process.env`. Reads are live (no snapshot);
 * `set`/`remove` mutate `process.env` directly. Writes are process-wide —
 * call sites that persist auth-derived values are marked `TODO(multi-instance)`.
 */
type State = Record<string, string | undefined>

export interface Interface {
  readonly get: (key: string) => Effect.Effect<string | undefined>
  readonly all: () => Effect.Effect<State>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Env") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: (key: string) => Effect.sync(() => process.env[key]),
    all: () => Effect.sync(() => ({ ...process.env })),
    set: Effect.fn("Env.set")((key: string, value: string) =>
      Effect.sync(() => {
        process.env[key] = value
      }),
    ),
    remove: Effect.fn("Env.remove")((key: string) =>
      Effect.sync(() => {
        delete process.env[key]
      }),
    ),
  }),
)

export const defaultLayer = layer

export * as Env from "."
