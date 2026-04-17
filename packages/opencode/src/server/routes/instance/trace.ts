import type { Context } from "hono"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"

type AppEnv = Parameters<typeof AppRuntime.runPromise>[0] extends Effect.Effect<any, any, infer R> ? R : never

// Build the base span attributes for an HTTP handler: method, path, and every
// matched route param (sessionID, messageID, partID, providerID, ptyID, …)
// prefixed with `opencode.`. This makes each request's root span searchable
// by ID in motel without having to parse the path string.
export interface RequestLike {
  readonly req: {
    readonly method: string
    readonly url: string
    param(): Record<string, string>
  }
}

export function requestAttributes(c: RequestLike): Record<string, string> {
  const attributes: Record<string, string> = {
    "http.method": c.req.method,
    "http.path": new URL(c.req.url).pathname,
  }
  for (const [key, value] of Object.entries(c.req.param())) {
    attributes[`opencode.${key}`] = value
  }
  return attributes
}

export function runRequest<A, E>(name: string, c: Context, effect: Effect.Effect<A, E, AppEnv>) {
  return AppRuntime.runPromise(effect.pipe(Effect.withSpan(name, { attributes: requestAttributes(c) })))
}

export async function jsonRequest<C extends Context, A, E>(
  name: string,
  c: C,
  effect: (c: C) => Effect.gen.Return<A, E, AppEnv>,
) {
  return c.json(
    await runRequest(
      name,
      c,
      Effect.gen(() => effect(c)),
    ),
  )
}
