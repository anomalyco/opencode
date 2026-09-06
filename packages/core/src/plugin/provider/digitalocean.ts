import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Clock, Deferred, Effect, Option, Schema, Semaphore, Stream } from "effect"
import type { Server } from "node:http"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.make("digitalocean")
const integrationID = Integration.ID.make("digitalocean")
const methodID = Integration.MethodID.make("browser")

const clientID = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82"
const authorizeEndpoint = "https://cloud.digitalocean.com/v1/oauth/authorize"
const routersEndpoint = "https://api.digitalocean.com/v2/gen-ai/models/routers"
const callbackPort = 1456
const callbackPath = "/auth/callback"
const tokenPath = "/auth/token"
const scopes = "genai:read inference:query"
const refreshIntervalMs = 5 * 60 * 1000
const routerPrefix = "router:"
const routerFamily = "digitalocean-inference-routers"

const Router = Schema.Struct({
  name: Schema.String,
  uuid: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
})
const RoutersResponse = Schema.Struct({
  model_routers: Schema.optional(Schema.Array(Router)),
})
const decodeRouters = Schema.decodeUnknownOption(RoutersResponse)

export function routersFromResponse(input: unknown): string[] {
  const decoded = Option.getOrUndefined(decodeRouters(input))
  if (!decoded?.model_routers) return []
  return decoded.model_routers.map((router) => router.name).filter((name) => name.length > 0)
}

export function routersFromMetadata(metadata?: Readonly<Record<string, unknown>>): string[] {
  const raw = metadata?.routers
  if (typeof raw !== "string" || raw.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry): string[] => {
    if (typeof entry === "string") return entry.length > 0 ? [entry] : []
    if (typeof entry === "object" && entry !== null && "name" in entry) {
      const name = (entry as Record<string, unknown>).name
      return typeof name === "string" && name.length > 0 ? [name] : []
    }
    return []
  })
}

export function routersFetchedAt(metadata?: Readonly<Record<string, unknown>>): number {
  const raw = metadata?.routersFetchedAt
  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : Number.NaN
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function authorizeURL(redirect: string, state: string): string {
  return `${authorizeEndpoint}?${new URLSearchParams({
    response_type: "token",
    client_id: clientID,
    redirect_uri: redirect,
    scope: scopes,
    state,
  })}`
}

const listRouters = (access: string, app: App.Info): Effect.Effect<string[], never> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(routersEndpoint, {
        headers: {
          Authorization: `Bearer ${access}`,
          Accept: "application/json",
          "User-Agent": App.useragent(app),
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      })
      if (!response.ok) return []
      return routersFromResponse(await response.json().catch(() => undefined))
    },
    catch: (cause) => cause,
  }).pipe(Effect.orElseSucceed(() => []))

type TokenPayload = {
  access: string
  expiresIn: number
}

const oauth = (app: App.Info) =>
  ({
    integrationID,
    method: {
      id: methodID,
      type: "oauth",
      label: "Login with DigitalOcean",
    },
    authorize: () =>
      Effect.gen(function* () {
        const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
        const token = yield* Deferred.make<TokenPayload, Error>()
        // Lazy so runtimes without a loopback listener (workerd) never evaluate node:http.
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://localhost")
          if (request.method === "GET" && url.pathname === callbackPath) {
            response
              .writeHead(200, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.bootstrap({ tokenPath, provider: "DigitalOcean" }))
            return
          }
          if (request.method === "POST" && url.pathname === tokenPath) {
            const chunks: Buffer[] = []
            request.on("data", (chunk: Buffer) => chunks.push(chunk))
            request.on("end", () => {
              const body = parseTokenBody(Buffer.concat(chunks).toString("utf8"))
              if (typeof body.error === "string" && body.error.length > 0) {
                const message =
                  typeof body.error_description === "string" && body.error_description.length > 0
                    ? body.error_description
                    : body.error
                Effect.runFork(Deferred.fail(token, new Error(message)))
                response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
                return
              }
              if (typeof body.access_token !== "string" || body.access_token.length === 0) {
                Effect.runFork(Deferred.fail(token, new Error("Missing access_token in callback")))
                response
                  .writeHead(400, { "Content-Type": "application/json" })
                  .end(JSON.stringify({ error: "missing_access_token" }))
                return
              }
              if (body.state !== state) {
                Effect.runFork(Deferred.fail(token, new Error("Invalid state - potential CSRF attack")))
                response
                  .writeHead(400, { "Content-Type": "application/json" })
                  .end(JSON.stringify({ error: "invalid_state" }))
                return
              }
              const expires = Number.parseInt(
                typeof body.expires_in === "string" ? body.expires_in : "0",
                10,
              )
              Effect.runFork(
                Deferred.succeed(token, {
                  access: body.access_token,
                  expiresIn: Number.isFinite(expires) && expires > 0 ? expires : 60 * 60 * 24 * 30,
                }),
              )
              response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
            })
            return
          }
          response.writeHead(404).end("Not found")
        })
        const port = yield* listen(server)
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        const redirect = `http://localhost:${port}${callbackPath}`
        return {
          mode: "auto" as const,
          url: authorizeURL(redirect, state),
          instructions:
            "Sign in to DigitalOcean in your browser. OpenCode uses your DigitalOcean token directly for inference and lists your Inference Routers as models. Routers refresh automatically.",
          callback: Deferred.await(token).pipe(
            Effect.flatMap((payload) =>
              Effect.gen(function* () {
                const routers = yield* listRouters(payload.access, app)
                const now = Date.now()
                return Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: payload.access,
                  refresh: "",
                  expires: now + payload.expiresIn * 1000,
                  metadata: {
                    routers: JSON.stringify(routers),
                    routersFetchedAt: now,
                  },
                })
              }),
            ),
          ),
        }
      }),
  }) satisfies IntegrationOAuthMethodRegistration

export const DigitalOceanPlugin = define({
  id: "opencode.provider.digitalocean",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded = { routers: [] as string[] }

    const load = Effect.fn("DigitalOceanPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      if (credential?.type !== "oauth" || credential.methodID !== methodID) {
        loaded.routers = []
        return
      }
      const now = yield* Clock.currentTimeMillis
      loaded.routers = routersFromMetadata(credential.metadata)
      if (loaded.routers.length > 0 && now - routersFetchedAt(credential.metadata) <= refreshIntervalMs) return
      if (credential.expires !== 0 && credential.expires <= now) return
      const routers = yield* listRouters(credential.access, ctx.app)
      if (routers.length > 0) loaded.routers = routers
    })

    yield* ctx.integration.transform((draft) => {
      draft.method.update(oauth(ctx.app))
    })
    yield* load()
    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(providerID)
      if (!item) return
      const routers = new Set(loaded.routers)
      for (const id of item.models.keys()) {
        if (id.startsWith(routerPrefix) && !routers.has(id.slice(routerPrefix.length)))
          evt.model.remove(providerID, id)
      }
      for (const name of routers) {
        evt.model.update(providerID, Model.ID.make(`${routerPrefix}${name}`), (draft) => {
          draft.name = name
          draft.family = Model.Family.make(routerFamily)
          draft.capabilities = { tools: true, input: ["text"], output: ["text"] }
          draft.limit = { context: 128_000, output: 8_192 }
        })
      }
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Pick up routers created after login without requiring a reconnect.
    yield* refresh().pipe(Effect.ignore, Effect.delay(refreshIntervalMs), Effect.forever, Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)

function parseTokenBody(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>
    return {}
  } catch {
    return {}
  }
}

function listen(server: Server) {
  return Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(callbackPort, "localhost", () => {
      server.off("error", onError)
      resume(Effect.succeed(callbackPort))
    })
  }).pipe(
    Effect.mapError((cause) =>
      "code" in cause && cause.code === "EADDRINUSE"
        ? new Error(
            `DigitalOcean login needs local port ${callbackPort}, but it is already in use. Stop the process using that port and try again.`,
          )
        : cause,
    ),
  )
}
