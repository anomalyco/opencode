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

    const redeem = Effect.fnUntraced(function* (code: string, request: HttpServerRequest.HttpServerRequest) {
      // Browsers ask for HTML; everything else is an API client that wants the token.
      const browser = request.headers.accept?.includes("text/html") === true
      const token = (yield* pairing.consume(code)) ? ServerAuth.issueSession(auth) : undefined
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
    })

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
          return yield* redeem(ctx.params.code, yield* HttpServerRequest.HttpServerRequest)
        }),
      )
      .handle(
        "server.connectPage",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          // HEAD probes (wslview, link checkers) and page loads (browsers, chat previews) must not spend the code.
          // The page's form POSTs back to this URL, which redeems it.
          if (request.method === "HEAD" || request.headers.accept?.includes("text/html"))
            return HttpServerResponse.text(CONNECT_PAGE, {
              contentType: "text/html; charset=utf-8",
              headers: {
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
                "content-security-policy":
                  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
              },
            })
          // Deprecated: clients built before POST redeem with a plain GET. Removed in the next minor.
          return yield* redeem(ctx.params.code, request)
        }),
      )
  }),
)

// Static, so nothing from the URL reaches the markup. The form has no action and posts back to the link itself.
const CONNECT_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connect to OpenCode</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { display: grid; place-items: center; min-height: 100vh; margin: 0; }
main { max-width: 22rem; padding: 1.5rem; text-align: center; }
h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
p { margin: 0 0 1.25rem; opacity: 0.75; line-height: 1.4; }
button { font: inherit; padding: 0.5rem 1.25rem; border-radius: 0.375rem; cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>Connect to OpenCode</h1>
<p>Sign this browser in to the OpenCode server that created this pairing link.</p>
<form method="post"><button type="submit" autofocus>Connect</button></form>
</main>
</body>
</html>
`
