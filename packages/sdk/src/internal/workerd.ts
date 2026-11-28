export * as WorkerdProfile from "./workerd"

import type { Config } from "@opencode/schema/config"
import { ServerWorkerd } from "@opencode/server/workerd"
import type { WorkerdMachineLink } from "@opencode/server/workerd-machine-link"
import { Effect } from "effect"
import type { EmbeddedHost } from "./host"

export type Configuration = Omit<typeof Config.Info.Encoded, "plugins">

export interface Options extends Omit<ServerWorkerd.Options, "config"> {
  readonly config?: Configuration
}

/**
 * The host profile serving `ServerWorkerd`'s routes and handler, so the SDK and the server boot workerd one way, and
 * the Durable Object's WebSocket methods, which reach the handler once the host has served it.
 */
export function make(
  options: Options,
): EmbeddedHost.Profile & { readonly hibernation: WorkerdMachineLink.Hibernation } {
  const server: ServerWorkerd.Options = {
    ...options,
    // Named like every other embedded host unless the embedder names it.
    app: { ...options.app, name: options.app?.name ?? "sdk" },
    config: options.config === undefined ? undefined : { content: JSON.stringify(options.config) },
  }
  // Set while the host is created, before `create` returns anything that could call these.
  let served: ServerWorkerd.Handler | undefined
  // Dropping a message would put the link's receive nonce out of step, so a call too early is a bug to surface.
  const handler = () => {
    if (!served) throw new Error("OpenCodeWorkerd received a WebSocket event before it finished booting")
    return served
  }
  return {
    routes: (overrides) => ServerWorkerd.routes(server, overrides),
    serve: (context) =>
      Effect.tap(ServerWorkerd.serve(context, server), (handler) =>
        Effect.sync(() => {
          served = handler
        }),
      ),
    password: options.password,
    hibernation: {
      webSocketMessage: (socket, message) => handler().webSocketMessage(socket, message),
      webSocketClose: (socket, code, reason, wasClean) => handler().webSocketClose(socket, code, reason, wasClean),
      webSocketError: (socket, error) => handler().webSocketError(socket, error),
    },
  }
}
