export * as ConfigMcpPlugin from "./mcp.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Document } from "@opencode/schema/config"
import type { ServerConfig } from "@opencode/schema/mcp"
import { Effect, Stream } from "effect"
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

  yield* events.pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() =>
      mcp.reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload MCP config", { cause }))),
    ),
    Effect.ignore,
    Effect.forkScoped({ startImmediately: true }),
  )

  // Read at reload time, so a reload right after a config change sees it before `config.updated` arrives.
  yield* mcp.transform((editor) => {
    const documents = config.snapshot().filter((entry): entry is Document => entry.type === "document")
    // Global timeout defaults merge in config order; each server can override them.
    const timeout = Object.assign(
      {},
      ...documents.flatMap((entry) => (entry.info.mcp?.timeout ? [entry.info.mcp.timeout] : [])),
    )
    const servers = new Map<string, ServerConfig>()
    for (const document of documents) {
      for (const [name, server] of Object.entries(document.info.mcp?.servers ?? {})) {
        servers.set(name, server)
      }
    }
    for (const [name, server] of servers) {
      if (editor.get(name)) continue
      editor.set(name, { ...server, timeout: { ...timeout, ...server.timeout } })
    }
  })
})
