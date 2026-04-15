import type { Context } from "hono"
import { Effect } from "effect"
import { AppRuntime } from "../../effect/app-runtime"

export function runRequest<A, E, R>(name: string, c: Context, effect: Effect.Effect<A, E, R>) {
  const url = new URL(c.req.url)
  return AppRuntime.runPromise(
    effect.pipe(
      Effect.withSpan(name, {
        attributes: {
          "http.method": c.req.method,
          "http.path": url.pathname,
        },
      }),
    ),
  )
}

export function jsonRequest<A, E, R>(name: string, effect: (c: Context) => Effect.gen.Return<A, E, R>) {
  return async (c: Context) =>
    c.json(
      await runRequest(
        name,
        c,
        Effect.gen(() => effect(c)),
      ),
    )
}
