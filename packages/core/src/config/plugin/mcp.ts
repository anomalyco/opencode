export * as ConfigMcpPlugin from "./mcp.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Document, type Entry } from "@opencode-ai/schema/config"
import type { ServerConfig } from "@opencode-ai/schema/mcp"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { Mcp } from "../../mcp/index.js"

export const Plugin = define({
  id: "opencode.config.mcp",
  effect: Effect.fn(function* (ctx) {
    yield* register(ctx.event.subscribe())
  }),
})

export const register = Effect.fn("ConfigMCPPlugin.register")(function* (
  events: Stream.Stream<{ readonly type: string }, unknown>,
) {
  const config = yield* Config.Service
  const mcp = yield* Mcp.Service
  const loaded = { entries: [] as Entry[] }

  yield* events.pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() =>
      config.entries().pipe(
        Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
        Effect.andThen(mcp.reload()),
        Effect.catchCause((cause) => Effect.logError("failed to reload MCP config", { cause })),
      ),
    ),
    Effect.ignore,
    Effect.forkScoped({ startImmediately: true }),
  )

  // Subscribe before the initial load so updates racing it trigger a rebuild.
  loaded.entries = yield* config.entries()
  yield* mcp.transform((draft) => {
    const documents = loaded.entries.filter((entry): entry is Document => entry.type === "document")
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
    for (const [name, server] of servers) {
      if (draft.get(name)) continue
      draft.set(name, server)
    }
  })
})
