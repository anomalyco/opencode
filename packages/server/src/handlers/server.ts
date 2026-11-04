import { hostname } from "node:os"
import { Duration, Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { UnauthorizedError } from "@opencode/protocol/errors"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { ServerInfo } from "../server-info"
import { ServerPairing } from "../pairing"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* ServerPairing.Service
    const auth = yield* ServerAuth.Config

    return handlers
      .handle("server.info", () =>
        Effect.gen(function* () {
          const info = yield* ServerInfo.Service
          return {
            version: info.app.version ?? "unknown",
            pid: process.pid ?? 0,
            hostname: hostname() || undefined,
            urls: info.urls(),
            paths: info.paths,
            capabilities: { persistentPty: PersistentPty.available },
          }
        }),
      )
      .handle("server.pair", () => pairing.issue())
      .handle(
        "server.connect",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          // Browser navigations ask for HTML; everything else is an API client that wants the token.
          const browser = request.headers.accept?.includes("text/html") === true
          // Chat clients fetch shared links to render a preview. A plain HTML fetch must not spend
          // the single-use code; only a real browser navigation carries Sec-Fetch-Mode: navigate.
          if (browser && request.headers["sec-fetch-mode"] !== "navigate")
            return HttpServerResponse.text(
              "<!doctype html><title>Connect this device</title><p>Open this link in your browser to connect this device.",
              { status: 200, contentType: "text/html; charset=utf-8" },
            )
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
