export * as WorkerdProfile from "./workerd"

import type { Config } from "@opencode/schema/config"
import { ServerWorkerd } from "@opencode/server/workerd"
import type { EmbeddedHost } from "./host"

export type Configuration = Omit<typeof Config.Info.Encoded, "plugins">

export interface Options extends Omit<ServerWorkerd.Options, "config"> {
  readonly config?: Configuration
}

/** The host profile serving `ServerWorkerd`'s routes and handler, so the SDK and the server boot workerd one way. */
export function make(options: Options): EmbeddedHost.Profile {
  const server: ServerWorkerd.Options = {
    ...options,
    // Named like every other embedded host unless the embedder names it.
    app: { ...options.app, name: options.app?.name ?? "sdk" },
    config: options.config === undefined ? undefined : { content: JSON.stringify(options.config) },
  }
  return {
    routes: (overrides) => ServerWorkerd.routes(server, overrides),
    serve: (context) => ServerWorkerd.serve(context, server),
    password: options.password,
  }
}
