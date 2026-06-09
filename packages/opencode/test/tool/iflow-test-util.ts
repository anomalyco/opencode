import { Cause, Effect, Exit } from "effect"

export const withEnv = <A, E, R>(env: Record<string, string | undefined>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

export const withIflowServer = <A, E, R>(
  handler: (request: Request) => Response | Promise<Response>,
  effect: (url: URL) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => Bun.serve({ port: 0, fetch: handler })),
    (server) => effect(server.url),
    (server) => Effect.sync(() => server.stop(true)),
  )

export const failureMessage = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit)
    if (Exit.isSuccess(exit)) throw new Error("Expected effect to fail")
    return Cause.pretty(exit.cause)
  })
