export * as ConsoleAccess from "./console-access.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { Credential } from "./credential.js"

/**
 * How the host keeps a connected Console's config fresh. `poll` re-checks it every minute in the background; without
 * it, the config refreshes only when a prompt starts, so a host that suspends between prompts stays idle.
 */
export const Options = Context.Reference<{ readonly poll: boolean }>("@opencode/ConsoleAccess/Options", {
  defaultValue: () => ({ poll: true }),
})

export const configured = (options?: { readonly poll?: boolean }) =>
  makeGlobalNode({ service: Options, layer: Layer.succeed(Options, { poll: options?.poll ?? true }), deps: [] })

export const node = configured()

export const defaultServer = "https://opencode.ai/console"

/** The OpenCode Console a credential signed in to. */
export function server(value: Credential.Value) {
  const server = typeof value.metadata?.server === "string" ? value.metadata.server : defaultServer
  // Credentials saved before August 2026 store the retired console.opencode.ai host, which maps path-for-path onto
  // the default server; rewriting it lets that host be shut down without forcing those users to reconnect.
  return server.replace(/^https:\/\/console\.opencode\.ai(?=\/|$)/, defaultServer)
}

/** Authenticates a Console request as the credential's member, in the workspace the sign-in chose. */
export function headers(value: Credential.Key | Credential.OAuth): Record<string, string> {
  const orgID = value.metadata?.orgID
  return {
    authorization: `Bearer ${value.type === "oauth" ? value.access : value.key}`,
    ...(typeof orgID === "string" ? { "x-org-id": orgID } : {}),
  }
}
