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
  'opencode:// URLs are off. Enable them with OPENCODE_FLAGS=opencode_api or "experimental": { "opencode_api": true }.',
)

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.succeed(Service, unavailable),
  deps: [],
})

/** The API path and query an `opencode:///api/...` URL names. A host is refused so a later remote form stays open. */
export function parseUri(raw: string) {
  const parsed = URL.parse(raw)
  if (!parsed || parsed.protocol !== "opencode:") return Effect.fail(new TypeError(`Invalid opencode URI: ${raw}`))
  if (parsed.host)
    return Effect.fail(
      new TypeError(`Invalid opencode URI "${raw}": omit the host, for example "opencode:///api/session".`),
    )
  return Effect.succeed({ path: `${parsed.pathname || "/"}${parsed.search}` })
}
