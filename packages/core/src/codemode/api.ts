export * as CodeModeApi from "./api.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly fetch: (request: Request) => Effect.Effect<Response, Error>
}

/** Sends a Code Mode `opencode://` request to this process's OpenCode API. The server provides the real one. */
export class Service extends Context.Service<Service, Interface>()("@opencode/CodeModeApi") {}

const failing = (message: string): Interface => ({ fetch: () => Effect.fail(new Error(message)) })

export const unavailable = failing("opencode:// URLs are unavailable in this environment.")

export const disabled = failing(
  'opencode:// URLs are off. In a local or dev build, enable them with OPENCODE_FLAGS=opencode_api or "experimental": { "opencode_api": true }.',
)

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.succeed(Service, unavailable),
  deps: [],
})

/**
 * The API path and query an `opencode:///api/...` URL names, with `/api/session/current` naming the calling session.
 * Only that form is accepted: no host (which keeps `opencode://<host>/` free for reaching another server later) and
 * nothing outside `/api/`.
 */
export function path(raw: string, sessionID: string) {
  const parsed = URL.parse(raw)
  if (!parsed || !raw.startsWith("opencode:///") || !parsed.pathname.startsWith("/api/"))
    return Effect.fail(
      new TypeError(`Invalid opencode URI "${raw}": use opencode:///api/..., for example "opencode:///api/session".`),
    )
  const pathname = parsed.pathname.replace(/^\/api\/session\/current(?=\/|$)/, `/api/session/${sessionID}`)
  return Effect.succeed(`${pathname}${parsed.search}`)
}
