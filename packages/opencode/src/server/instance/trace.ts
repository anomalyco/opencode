import type { Context } from "hono"
import { Effect } from "effect"
import { AppRuntime } from "../../effect/app-runtime"

export function runRequest<A, E>(name: string, c: Context, effect: Effect.Effect<A, E, any>) {
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

export async function jsonRequest<C extends Context, A, E>(
  name: string,
  c: C,
  effect: (c: C) => Effect.gen.Return<A, E, any>,
) {
  return c.json(
    await runRequest(
      name,
      c,
      Effect.gen(() => effect(c)),
    ),
  )
}
