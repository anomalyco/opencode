export * as ConfigMcpPlugin from "./mcp.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Document, type Entry } from "@opencode/schema/config"
import type { ServerConfig } from "@opencode/schema/mcp"
import { Effect, Stream } from "effect"
import { isDeepStrictEqual } from "node:util"
import { Config } from "../../config.js"
import { Mcp } from "../../mcp/index.js"

export const Plugin = define({
  id: "opencode.config.mcp",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx.event.subscribe({ types: ["config.updated"] }))
  }),
})

export const register = Effect.fn("ConfigMCPPlugin.register")(function* (
  events: Stream.Stream<{ readonly type: string }, unknown>,
) {
  const config = yield* Config.Service
  const mcp = yield* Mcp.Service
  const loaded = { servers: new Map<string, ServerConfig>() }

  yield* events.pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() =>
      Effect.gen(function* () {
        const servers = resolve(yield* config.entries())
        if (isDeepStrictEqual(loaded.servers, servers)) return
        loaded.servers = servers
        yield* mcp.reload()
      }).pipe(Effect.catchCause((cause) => Effect.logError("failed to reload MCP config", { cause }))),
    ),
    Effect.ignore,
    Effect.forkScoped({ startImmediately: true }),
  )

  // Subscribe before the initial load so updates racing it trigger a rebuild.
  loaded.servers = resolve(yield* config.entries())
  yield* mcp.transform((editor) => {
    for (const [name, server] of loaded.servers) {
      if (editor.get(name)) continue
      editor.set(name, server)
    }
  })
})

function resolve(entries: Entry[]) {
  const documents = entries.filter((entry): entry is Document => entry.type === "document")
  // Global timeout defaults merge in config order; each server can override them.
  const timeout = Object.assign(
    {},
    ...documents.flatMap((entry) => (entry.info.mcp?.timeout ? [entry.info.mcp.timeout] : [])),
  )
  const servers = new Map<string, ServerConfig>()
  for (const document of documents) {
    for (const [name, server] of Object.entries(document.info.mcp?.servers ?? {})) {
      servers.set(name, { ...server, timeout: { ...timeout, ...server.timeout } })
    }
  }
  return servers
}
