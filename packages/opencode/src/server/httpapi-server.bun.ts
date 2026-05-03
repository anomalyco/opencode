import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/unstable/http"
import type { Opts } from "./adapter"
import { Service } from "./httpapi-server"

export { Service }

export const name = "bun-http-server"
let buildLock = Promise.resolve()

function lock() {
  let release = () => {}
  const previous = buildLock
  buildLock = new Promise<void>((resolve) => {
    release = resolve
  })
  return previous.then(() => release)
}

export const layer = (opts: Opts) => {
  const serverRef = { forceStop: false }
  return Layer.mergeAll(
    Layer.effect(
      HttpServer.HttpServer,
      Effect.gen(function* () {
        const release = yield* Effect.promise(() => lock())
        const serve = Bun.serve
        let captured = false
        yield* Effect.sync(() => {
          // BunHttpServer owns the Bun.Server instance; capture it so
          // listener.stop(true) can make its finalizer force-close keep-alives.
          Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
            const server = serve(options)
            if (captured || options.port !== opts.port || options.hostname !== opts.hostname) return server
            captured = true
            const stop = server.stop.bind(server)
            server.stop = ((closeActiveConnections?: boolean) =>
              stop(closeActiveConnections || serverRef.forceStop)) as typeof server.stop
            return server
          }) as typeof Bun.serve
        })
        return yield* BunHttpServer.make({
          port: opts.port,
          hostname: opts.hostname,
          gracefulShutdownTimeout: "1 second",
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              Bun.serve = serve
              release()
            }),
          ),
        )
      }),
    ),
    BunHttpServer.layerHttpServices,
    Layer.succeed(Service)(
      Service.of({
        closeAll: Effect.sync(() => {
          serverRef.forceStop = true
        }),
      }),
    ),
  )
}
