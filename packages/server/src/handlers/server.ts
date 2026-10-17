import { Duration, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Session } from "@opencode/core/session"
import { Bus } from "@opencode/core/bus"
import { ServiceEvent } from "@opencode/schema/service-event"
import { InvalidRequestError, UnauthorizedError } from "@opencode/protocol/errors"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { ServerInfo } from "../server-info"
import { ServerPairing } from "../pairing"
import { RestartIntent } from "../restart-intent"

// Deadline for a pending restart request. Kept in step with the CLI's own
// approval wait; the requester releases first when it is alive.
const RestartApprovalTtl = Duration.minutes(2)

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    const auth = yield* ServerAuth.Config
    const session = yield* Session.Service
    const intent = yield* RestartIntent.Service
    const bus = yield* Bus.Service

    return handlers
      .handle("server.info", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          return {
            version: info.app.version ?? "unknown",
            pid: process.pid ?? 0,
            urls: info.urls(),
            paths: info.paths,
            capabilities: { persistentPty: PersistentPty.available },
          }
        }),
      )
      .handle("server.pair", () => pairing.issue())
      .handle(
        "server.restart.request",
        Effect.fn(function* () {
          const active = Array.from(yield* session.active)
          const generation = yield* intent.request()
          yield* bus.publish(ServiceEvent.Requested, { active }, { global: true })
          // Backstop for a requester that dies without releasing: the requester
          // covers its own timeout, this covers SIGKILL and shell-tool kills.
          // Detached so it outlives this request's scope.
          yield* Effect.sleep(RestartApprovalTtl).pipe(
            Effect.andThen(intent.expire(generation)),
            Effect.flatMap((expired) =>
              expired ? bus.publish(ServiceEvent.Expired, {}, { global: true }) : Effect.void,
            ),
            Effect.forkDetach,
          )
          return { active }
        }),
      )
      .handle(
        "server.restart.resolve",
        Effect.fn(function* (ctx) {
          const settled = yield* intent.resolve(ctx.payload.decision)
          if (settled === undefined) {
            return yield* new InvalidRequestError({ message: "No pending service restart request" })
          }
          if (settled.fresh) {
            yield* bus.publish(ServiceEvent.Resolved, { decision: settled.winner }, { global: true })
          }
          return { decision: settled.winner }
        }),
      )
      .handle(
        "server.connect",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          // Browser navigations ask for HTML; everything else is an API client that wants the token.
          const browser = request.headers.accept?.includes("text/html") === true
          const token = (yield* pairing.consume(ctx.params.code)) ? ServerAuth.issueSession(auth) : undefined
          if (token === undefined) {
            if (!browser) return yield* new UnauthorizedError({ message: "Pairing link expired or already used" })
            return HttpServerResponse.text(
              "This pairing link expired or was already used. Run `opencode pair` to get a new one.",
              { status: 401 },
            )
          }
          if (!browser) return { token }
          return HttpServerResponse.redirect("/").pipe(
            HttpServerResponse.setCookieUnsafe(ServerAuth.sessionCookieName(request.headers.host), token, {
              path: "/",
              httpOnly: true,
              sameSite: "lax",
              maxAge: Duration.seconds(ServerAuth.SESSION_TTL_SECONDS),
            }),
          )
        }),
      )
  }),
)
