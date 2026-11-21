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
          // All HTML GETs are inert, including browser navigations and previews. HTTP LAN browsers
          // do not send Fetch Metadata, so only an explicit form POST should spend the code.
          if (request.headers.accept?.includes("text/html"))
            return HttpServerResponse.text(
              '<!doctype html><html><head><meta charset="utf-8"><title>Connect this device</title></head><body><h1>Connect this device</h1><p>Confirm to sign in to this OpenCode server.</p><form method="post"><button type="submit">Connect this device</button></form></body></html>',
              {
                contentType: "text/html; charset=utf-8",
                headers: {
                  "cache-control": "no-store",
                  "referrer-policy": "same-origin",
                  "content-security-policy":
                    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
                },
              },
            )
          const token = (yield* pairing.consume(ctx.params.code)) ? ServerAuth.issueSession(auth) : undefined
          if (token === undefined)
            return yield* new UnauthorizedError({ message: "Pairing link expired or already used" })
          return { token }
        }),
      )
      .handle(
        "server.confirm",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          // Match the host check used for session-cookie authorization, including TLS-terminating proxies.
          const origin = URL.parse(request.headers.origin ?? "")
          if (!origin || !["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.host)
            return HttpServerResponse.text("Confirm this pairing link from the same server.", { status: 403 })
          const token = (yield* pairing.consume(ctx.params.code)) ? ServerAuth.issueSession(auth) : undefined
          if (token === undefined)
            return HttpServerResponse.text(
              "This pairing link expired or was already used. Run `opencode pair` to get a new one.",
              { status: 401 },
            )
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
