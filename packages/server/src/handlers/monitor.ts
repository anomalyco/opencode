import { Monitor } from "@opencode/core/monitor"
import { Session } from "@opencode/core/session"
import { MonitorNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { missingSession } from "./session-error"

export const MonitorHandler = HttpApiBuilder.group(Api, "server.monitor", (handlers) =>
  Effect.gen(function* () {
    const monitor = yield* Monitor.Service
    const session = yield* Session.Service

    return handlers
      .handle(
        "monitor.list",
        Effect.fn(function* (ctx) {
          yield* session.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return yield* monitor.list(ctx.params.sessionID)
        }),
      )
      .handle(
        "monitor.output",
        Effect.fn(function* (ctx) {
          yield* session.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return yield* monitor
            .output({ ...ctx.params, ...ctx.query })
            .pipe(
              Effect.catchTag("Monitor.NotFoundError", (error) =>
                Effect.fail(
                  new MonitorNotFoundError({ id: error.id, message: "Monitor output is no longer available" }),
                ),
              ),
            )
        }),
      )
      .handle(
        "monitor.stop",
        Effect.fn(function* (ctx) {
          yield* session.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return yield* monitor
            .stop(ctx.params)
            .pipe(
              Effect.catchTag("Monitor.NotFoundError", (error) =>
                Effect.fail(new MonitorNotFoundError({ id: error.id, message: "Monitor not found" })),
              ),
            )
        }),
      )
  }),
)
