export * as McpEventTools from "./mcp-events.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Flag } from "../../flag.js"
import { Mcp } from "../../mcp/index.js"
import { Permission } from "../../permission.js"

// Shaped like the event trigger it feeds, `{ server, event, args }`, so entries need no explaining.
const EventType = Schema.Struct({
  server: Schema.String,
  event: Schema.String,
  description: Schema.optional(Schema.String),
  args: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown).annotate({ description: "JSON Schema of the trigger's args" }),
  ),
  data: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown).annotate({
      description: "JSON Schema of the data each event carries",
    }),
  ),
})

export const Plugin = {
  id: "opencode.tools.mcp-events",
  effect: Effect.fn("McpEventTools.Plugin")(function* (ctx: Context) {
    if (!(yield* Flag.enabled("mcp_events"))) return
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "list_mcp_events",
          options: { namespace: "opencode", codemode: true },
          description: "List the events MCP servers send. Use one as an automation's event trigger.",
          input: Schema.Struct({
            server: Schema.optionalKey(
              Schema.String.annotate({ description: "MCP server name as configured. Omit to list every server." }),
            ),
          }),
          output: Schema.Struct({ events: Schema.Array(EventType) }),
          execute: (input, context) =>
            Effect.gen(function* () {
              const servers =
                input.server === undefined
                  ? (yield* mcp.servers()).flatMap((server) =>
                      server.status.status === "connected" ? [server.name] : [],
                    )
                  : [input.server]
              // Listing every server checks each server name so per-server rules still apply.
              yield* permission.assert({
                action: "opencode_list_mcp_events",
                resources: servers,
                save: servers,
                metadata: {},
                ...Permission.invocation(context),
              })
              // A server that is unreachable or offers no events lists none.
              const lists = yield* Effect.forEach(
                servers,
                (server) =>
                  mcp.events(server).pipe(
                    Effect.flatMap((events) => events?.list() ?? Effect.succeed([])),
                    // Automations can only use events the server pushes.
                    Effect.map((types) =>
                      types
                        .filter((type) => type.delivery?.includes("push"))
                        .map((type) => ({
                          server,
                          event: type.name,
                          description: type.description,
                          args: type.inputSchema,
                          data: type.payloadSchema,
                        })),
                    ),
                    Effect.orElseSucceed(() => []),
                  ),
                { concurrency: "unbounded" },
              )
              return { output: { events: lists.flat() } }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
