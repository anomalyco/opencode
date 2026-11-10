export * as McpEventTools from "./mcp-events.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Hash } from "@opencode/util/hash"
import { Effect, Schema, Scope, Stream } from "effect"
import { Flag } from "../../flag.js"
import { Mcp } from "../../mcp/index.js"
import { Permission } from "../../permission.js"
import { SessionMessage } from "../../session/message.js"

const EventType = Schema.Struct({
  server: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const Plugin = {
  id: "opencode.tools.mcp-events",
  effect: Effect.fn("McpEventTools.Plugin")(function* (ctx: Context) {
    if (!(yield* Flag.enabled("mcp_events"))) return
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service
    const scope = yield* Scope.Scope

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "watch_mcp_event",
          options: { namespace: "opencode", codemode: true },
          description:
            "Wake this session when an MCP server sends an event, such as a finished job or a new message, instead of polling. Omit event to list the event types connected servers offer and the arguments each takes. The session wakes with the event's data.",
          input: Schema.Struct({
            server: Schema.optionalKey(
              Schema.String.annotate({ description: "MCP server name as configured. Omit to list every server." }),
            ),
            event: Schema.optionalKey(
              Schema.String.annotate({ description: "Event type to watch. Omit to list event types instead." }),
            ),
            arguments: Schema.optionalKey(
              Schema.Record(Schema.String, Schema.Unknown).annotate({
                description: "The event type's arguments, as its inputSchema describes",
              }),
            ),
            cursor: Schema.optionalKey(
              Schema.String.annotate({
                description: "Where to start, such as a cursor a tool result gave. Omit to start from now.",
              }),
            ),
            once: Schema.optionalKey(
              Schema.Boolean.annotate({
                description:
                  "Stop after the first event (default). false wakes on every event until the session is deleted.",
              }),
            ),
          }),
          output: Schema.Struct({
            events: Schema.optional(Schema.Array(EventType)),
            watching: Schema.optional(Schema.String),
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              const servers =
                input.server === undefined
                  ? (yield* mcp.servers()).flatMap((server) =>
                      server.status.status === "connected" ? [server.name] : [],
                    )
                  : [input.server]
              yield* permission.assert({
                action: "opencode_watch_mcp_event",
                resources: servers,
                save: servers,
                metadata: {},
                ...Permission.invocation(context),
              })
              if (input.event === undefined) {
                // A server that is unreachable or offers no events lists none.
                const lists = yield* Effect.forEach(
                  servers,
                  (server) =>
                    mcp.events(server).pipe(
                      Effect.flatMap((events) => events?.list() ?? Effect.succeed([])),
                      Effect.map((types) => types.map((type) => ({ server, ...type }))),
                      Effect.orElseSucceed(() => []),
                    ),
                  { concurrency: "unbounded" },
                )
                return { output: { events: lists.flat() } }
              }
              const server = input.server
              const name = input.event
              if (server === undefined)
                return yield* new ToolFailure({ message: "Name the server to watch an event on" })
              const events = yield* mcp.events(server)
              if (!events)
                return yield* new ToolFailure({
                  message: `MCP server "${server}" is not connected or offers no events`,
                })

              const sessionID = context.sessionID
              let cursor: string | null | undefined = input.cursor
              let closes = 0
              // A server that closes the stream itself, as when it restarts in place, is followed from the last
              // cursor, until it closes it three times in a row without sending anything.
              const follow = (): ReturnType<typeof events.stream> =>
                events
                  .stream({ name, arguments: input.arguments, cursor })
                  .pipe(
                    Stream.concat(
                      Stream.unwrap(
                        Effect.suspend(() =>
                          ++closes >= 3
                            ? Effect.fail(new Error("the server kept closing the stream"))
                            : Effect.sleep("500 millis").pipe(Effect.as(follow())),
                        ),
                      ),
                    ),
                  )
              const deleted = ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
                Stream.filter((event) => event.data.sessionID === sessionID),
                Stream.runHead,
              )
              yield* follow().pipe(
                (stream) => (input.once === false ? stream : Stream.take(stream, 1)),
                Stream.interruptWhen(deleted),
                Stream.runForEach((event) => {
                  closes = 0
                  if (event.cursor !== undefined) cursor = event.cursor
                  return ctx.session.synthetic({
                    sessionID,
                    // A replayed event maps to the same message, which is admitted once.
                    id: SessionMessage.ID.make(
                      `msg_mcp_${Hash.sha256([sessionID, server, name, JSON.stringify(input.arguments ?? {}), event.eventId].join("\0")).slice(0, 26)}`,
                    ),
                    description: `${server} ${event.name}`,
                    text: `<mcp_event server="${server}" event="${event.name}" id="${event.eventId}" timestamp="${event.timestamp}">\n${JSON.stringify(event.data)}\n</mcp_event>`,
                    metadata: { source: "mcp.event", server, event: event.name, eventID: event.eventId },
                  })
                }),
                // The session was told not to poll, so a watch that fails says so rather than going quiet.
                Effect.catch((error) =>
                  ctx.session.synthetic({
                    sessionID,
                    description: `${server} ${name} watch stopped`,
                    text: `Watching ${server} ${name} stopped: ${error instanceof Error ? error.message : String(error)}`,
                    metadata: { source: "mcp.event", server, event: name },
                  }),
                ),
                Effect.catch((error) => Effect.logWarning("MCP event watch ended", { server, event: name, error })),
                Effect.forkIn(scope, { startImmediately: true }),
              )
              return {
                output: { watching: `${server} ${name}` },
                content: `Watching ${server} ${name}. This session wakes when it fires, so don't poll.`,
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: error.message, error }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
