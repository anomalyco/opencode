import { Effect } from "effect"
import type { OpenCodeClient } from "@opencode-ai/client"

// Resolve through the MCP-owned integrationID rather than matching integration names: the shared
// integration registry also holds provider/plugin integrations, whose names could collide with a server.
// Fails when the server is unknown; returns undefined when the server has no integration (e.g. a local
// or anonymous server), leaving that case for the caller to interpret.
export const resolveIntegration = (client: OpenCodeClient, name: string, location: { directory: string }) =>
  Effect.gen(function* () {
    const servers = yield* Effect.promise(() => client.mcp.list({ location }))
    const server = servers.data.find((entry) => entry.name === name)
    if (!server) return yield* Effect.fail(new Error(`MCP server not found: ${name}`))
    const integrationID = server.integrationID
    if (!integrationID) return undefined
    return yield* Effect.promise(() => client.integration.get({ integrationID, location })).pipe(
      Effect.map((result) => result.data ?? undefined),
    )
  })
