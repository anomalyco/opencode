export * as McpEventTools from "./mcp-events.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
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
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "list_mcp_events",
          options: { namespace: "opencode", codemode: true },
          description: "List the events an MCP server sends. Use one as an automation's event trigger.",
          input: Schema.Struct({
            server: Schema.String.annotate({ description: "MCP server name as configured" }),
          }),
          output: Schema.Struct({ events: Schema.Array(EventType) }),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "opencode_list_mcp_events",
                resources: [input.server],
                save: [input.server],
                metadata: {},
                ...Permission.invocation(context),
              })
              const events = yield* mcp.events(input.server)
              if (!events)
                return yield* new ToolFailure({
                  message: `MCP server "${input.server}" is not connected or sends no events`,
                })
              // Automations can only use events the server pushes.
              const types = (yield* events.list()).filter((type) => type.delivery?.includes("push"))
              return {
                output: {
                  events: types.map((type) => ({
                    server: input.server,
                    event: type.name,
                    description: type.description,
                    args: type.inputSchema,
                    data: type.payloadSchema,
                  })),
                },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
