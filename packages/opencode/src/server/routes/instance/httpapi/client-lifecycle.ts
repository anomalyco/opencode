import { Context, Effect, Layer } from "effect"

export type Options = {
  initialGraceMs?: number
  lastClientGraceMs?: number
}

export interface Interface {
  readonly acquire: Effect.Effect<Effect.Effect<void>>
  readonly idle: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HttpApiClientLifecycle") {}

const noop = Service.of({
  acquire: Effect.succeed(Effect.void),
  idle: Effect.never,
})

export function layer(options?: boolean | Options) {
  if (!options) return Layer.succeed(Service)(noop)

  const normalized = typeof options === "boolean" ? {} : options
  const initialGraceMs = normalized.initialGraceMs ?? 60_000
  const lastClientGraceMs = normalized.lastClientGraceMs ?? 2_000

  return Layer.effect(
    Service,
    Effect.gen(function* () {
      let active = 0
      let closed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let resolveIdle!: () => void
      const idle = new Promise<void>((resolve) => {
        resolveIdle = resolve
      })

      const clear = () => {
        if (!timer) return
        clearTimeout(timer)
        timer = undefined
      }

      const complete = () => {
        if (closed) return
        closed = true
        clear()
        resolveIdle()
      }

      const schedule = (delay: number) => {
        clear()
        timer = setTimeout(() => {
          if (active === 0) complete()
        }, delay)
        timer.unref?.()
      }

      schedule(initialGraceMs)

      yield* Effect.addFinalizer(() => Effect.sync(clear))

      return Service.of({
        acquire: Effect.sync(() => {
          let released = false
          if (closed) return Effect.void
          active += 1
          clear()
          return Effect.sync(() => {
            if (released || closed || active === 0) return
            released = true
            active -= 1
            if (active === 0) schedule(lastClientGraceMs)
          })
        }),
        idle: Effect.promise(() => idle),
      })
    }),
  )
}

export * as ClientLifecycle from "./client-lifecycle"
