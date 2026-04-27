import { Context, Effect, Layer } from "effect"

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
    get: Effect.fn("Env.get")((key: string) => Effect.sync(() => process.env[key])),
    all: Effect.fn("Env.all")(() => Effect.sync(() => ({ ...process.env }) as State)),
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
