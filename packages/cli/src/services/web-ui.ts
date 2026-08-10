import { NodeHttpServer, NodeSocket } from "@effect/platform-node"
import { Service, type Endpoint } from "@opencode-ai/client/effect/service"
import { ServerInfo } from "@opencode-ai/server/server-info"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Context, Effect, Exit, Ref, Scope, Stream } from "effect"
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { load } from "../app-assets"

const UI_UPSTREAM = new URL("https://app.opencode.ai")
const COOKIE = "opencode-web"
const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

export const start = Effect.fn("cli.web-ui.start")(function* (
  endpoint: Ref.Ref<Endpoint>,
  options?: { readonly assets?: Readonly<Record<string, string>> },
) {
  const token = randomBytes(32).toString("base64url")
  const origin = yield* listen(endpoint, {
    auth: { type: "cookie", token },
    hostname: "127.0.0.1",
    port: 0,
    assets: options?.assets,
  })
  return `${origin}/?cli_token=${encodeURIComponent(token)}`
})

export const serve = Effect.fn("cli.web-ui.serve")(function* (
  endpoint: Ref.Ref<Endpoint>,
  options: {
    readonly hostname: string
    readonly port?: number
    readonly password: string
    readonly assets?: Readonly<Record<string, string>>
  },
) {
  return yield* listen(endpoint, {
    auth: { type: "basic", password: options.password },
    hostname: options.hostname,
    port: options.port,
    assets: options.assets,
  })
})

const listen = Effect.fnUntraced(function* (
  endpoint: Ref.Ref<Endpoint>,
  options: {
    readonly auth: { readonly type: "cookie"; readonly token: string } | { readonly type: "basic"; readonly password: string }
    readonly hostname: string
    readonly port?: number
    readonly assets?: Readonly<Record<string, string>>
  },
) {
  const assets = options.assets ?? (yield* Effect.promise(load))
  const client = yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))
  const websocket = yield* Socket.WebSocketConstructor.pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS))
  const server = yield* bind(options.hostname, options.port)
  const origin = formatAddress(server.http.address)
  const urls = ServerInfo.connectionURLs(origin, options.hostname)
  yield* server.http.serve(
    handle({ endpoint, auth: options.auth, assets, client, websocket, origin, urls }),
  ).pipe(Effect.provideService(Scope.Scope, server.scope))
  return origin
})

function handle(input: {
  readonly endpoint: Ref.Ref<Endpoint>
  readonly auth: { readonly type: "cookie"; readonly token: string } | { readonly type: "basic"; readonly password: string }
  readonly assets: Readonly<Record<string, string>>
  readonly client: HttpClient.HttpClient
  readonly websocket: Context.Service.Shape<typeof Socket.WebSocketConstructor>
  readonly origin: string
  readonly urls: ReadonlyArray<string>
}) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, input.origin)
    if (input.auth.type === "cookie" && request.headers.host !== new URL(input.origin).host)
      return HttpServerResponse.empty({ status: 403 })
    const queryToken = url.searchParams.get(input.auth.type === "cookie" ? "cli_token" : "auth_token")
    const queryAuthorized = input.auth.type === "cookie" && matches(queryToken, input.auth.token)
    if (input.auth.type === "cookie" && queryToken !== null && request.headers.upgrade?.toLowerCase() !== "websocket") {
      if (!queryAuthorized) return HttpServerResponse.empty({ status: 401 })
      url.searchParams.delete("cli_token")
      return HttpServerResponse.empty({
        status: 302,
        headers: {
          location: url.pathname + url.search + url.hash,
          "set-cookie": `${COOKIE}=${input.auth.token}; HttpOnly; SameSite=Strict; Path=/`,
          "cache-control": "no-store",
        },
      })
    }
    if (input.auth.type === "cookie" && !queryAuthorized && !authorized(request.headers.cookie, input.auth.token))
      return unauthorized(false)
    if (
      input.auth.type === "basic" &&
      !hasPtyTicket(url) &&
      !basicAuthorized(request.headers.authorization, queryToken, input.auth.password)
    )
      return unauthorized(true)
    url.searchParams.delete("cli_token")
    url.searchParams.delete("auth_token")
    const requestOrigin = request.headers.host ? `http://${request.headers.host}` : input.origin
    if (request.headers.origin !== undefined && request.headers.origin !== requestOrigin)
      return HttpServerResponse.empty({ status: 403 })

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const endpoint = yield* Ref.get(input.endpoint)
      const target = new URL(url.pathname + url.search, endpoint.url)
      if (request.headers.upgrade?.toLowerCase() === "websocket")
        return yield* proxyWebSocket(request, target, input.websocket)
      return yield* proxyHttp(input.client, request, target, Service.headers(endpoint), false, input.urls)
    }
    return yield* serveUI(input.client, request, url, input.assets)
  })
}

function serveUI(
  client: HttpClient.HttpClient,
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  assets: Readonly<Record<string, string>>,
) {
  const key = url.pathname.replace(/^\//, "")
  const file = assets[key] ?? assets["index.html"]
  if (!file) return proxyHttp(client, request, new URL(url.pathname + url.search, UI_UPSTREAM), undefined, true)
  if (request.method !== "GET" && request.method !== "HEAD") return Effect.succeed(HttpServerResponse.empty({ status: 405 }))
  return Effect.tryPromise(() => readFile(file)).pipe(
    Effect.map((body) => {
      const html = key === "" || file === assets["index.html"]
      const headers = {
        "content-type": FSUtil.mimeType(file),
        "cache-control": html ? "no-cache" : "public, max-age=31536000, immutable",
        "content-security-policy": html ? cspForHtml(body.toString()) : csp(),
        "x-content-type-options": "nosniff",
      }
      if (request.method === "HEAD") return HttpServerResponse.empty({ headers })
      return HttpServerResponse.raw(body, { headers })
    }),
    Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
  )
}

function proxyHttp(
  client: HttpClient.HttpClient,
  request: HttpServerRequest.HttpServerRequest,
  target: URL,
  extra: HeadersInit | undefined,
  ui = false,
  publicURLs?: ReadonlyArray<string>,
) {
  return client
    .execute(
      HttpClientRequest.make(request.method as never)(target, {
        headers: proxyHeaders(request.headers, extra),
        body: requestBody(request),
      }),
    )
    .pipe(
      Effect.flatMap((response) => {
        const headers = new Headers(response.headers)
        headers.delete("content-encoding")
        headers.delete("content-length")
        headers.delete("set-cookie")
        if (publicURLs && target.pathname === "/api/server")
          return Effect.succeed(HttpServerResponse.jsonUnsafe({ urls: publicURLs }, { status: response.status }))
        if (ui && response.headers["content-type"]?.includes("text/html")) {
          return response.text.pipe(
            Effect.map((body) => {
              headers.set("content-security-policy", cspForHtml(body))
              headers.set("cache-control", "no-store")
              return HttpServerResponse.text(body, { status: response.status, headers })
            }),
          )
        }
        if (ui) headers.set("content-security-policy", csp())
        return Effect.succeed(
          HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
            status: response.status,
            headers,
          }),
        )
      }),
      Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 502 }))),
    )
}

function proxyWebSocket(
  request: HttpServerRequest.HttpServerRequest,
  target: URL,
  websocket: Context.Service.Shape<typeof Socket.WebSocketConstructor>,
) {
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
  return Effect.scoped(
    Effect.gen(function* () {
      const inbound = yield* Effect.orDie(request.upgrade)
      const outbound = yield* Socket.makeWebSocket(target.toString(), {
        protocols: protocols(request.headers["sec-websocket-protocol"]),
        closeCodeIsError: () => false,
      }).pipe(Effect.provideService(Socket.WebSocketConstructor, websocket))
      const writeInbound = yield* inbound.writer
      const writeOutbound = yield* outbound.writer
      const close = Effect.all(
        [writeInbound(new Socket.CloseEvent()), writeOutbound(new Socket.CloseEvent())],
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.timeout("1 second"), Effect.catch(() => Effect.void))
      yield* Effect.raceFirst(
        outbound.runRaw((message) => writeInbound(typeof message === "string" ? message : message.slice())),
        inbound.runRaw((message) => writeOutbound(typeof message === "string" ? message : message.slice())),
      ).pipe(Effect.catch(() => Effect.void), Effect.ensuring(close))
      return HttpServerResponse.empty()
    }).pipe(Effect.orDie),
  )
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  if (request.source instanceof Request && request.source.body === null) return HttpBody.empty
  const length = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], length ? Number(length) : undefined)
}

function proxyHeaders(input: Record<string, string>, extra?: HeadersInit) {
  const headers = new Headers(input)
  for (const key of input.connection?.split(",").map((item) => item.trim()) ?? []) headers.delete(key)
  for (const key of hop) headers.delete(key)
  headers.delete("accept-encoding")
  headers.delete("authorization")
  headers.delete("cookie")
  if (extra) for (const [key, value] of new Headers(extra)) headers.set(key, value)
  return headers
}

function authorized(cookie: string | undefined, token: string) {
  const value = cookie
    ?.split(";")
    .map((item) => item.trim().split("="))
    .find(([key]) => key === COOKIE)?.[1]
  return matches(value ?? null, token)
}

function basicAuthorized(header: string | undefined, queryToken: string | null, password: string) {
  const expected = Buffer.from(`opencode:${password}`).toString("base64")
  if (matches(queryToken, expected)) return true
  if (!header?.startsWith("Basic ")) return false
  return matches(header.slice("Basic ".length), expected)
}

function hasPtyTicket(url: URL) {
  return /^\/api\/pty\/[^/]+\/connect$/.test(url.pathname) && !!url.searchParams.get("ticket")
}

function unauthorized(basic: boolean) {
  return HttpServerResponse.empty({
    status: 401,
    headers: basic ? { "www-authenticate": 'Basic realm="Secure Area"' } : undefined,
  })
}

function matches(value: string | null, expected: string) {
  if (value === null) return false
  const left = Buffer.from(value)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function protocols(value: string | undefined) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function csp(hash = "") {
  return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data: blob:`
}

function cspForHtml(body: string) {
  const match = body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(["'])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

function bind(hostname: string, port: number | undefined) {
  if (port !== undefined) return bindPort(hostname, port)
  const next = (candidate: number): ReturnType<typeof bindPort> =>
    bindPort(hostname, candidate).pipe(
      Effect.catch((error) =>
        candidate < 65_535 && addressInUse(error) ? next(candidate + 1) : Effect.fail(error),
      ),
    )
  return next(4096)
}

function bindPort(hostname: string, port: number) {
  return Effect.gen(function* () {
    const sockets = new Set<{ destroy(): void }>()
    const server = createServer()
    const scope = yield* Scope.make()
    server.on("connection", (socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => sockets.forEach((socket) => socket.destroy())).pipe(
        Effect.andThen(Scope.close(scope, Exit.void)),
      ),
    )
    const http = yield* NodeHttpServer.make(() => server, { host: hostname, port }).pipe(
      Effect.provideService(Scope.Scope, scope),
    )
    return { http, scope }
  })
}

function formatAddress(address: HttpServer.Address) {
  if (address._tag === "UnixAddress") return HttpServer.formatAddress(address)
  const hostname = address.hostname.includes(":") ? `[${address.hostname}]` : address.hostname
  return `http://${hostname}:${address.port}`
}

function addressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && error.code === "EADDRINUSE") return true
  return "cause" in error && addressInUse(error.cause)
}

export * as WebUi from "./web-ui"
