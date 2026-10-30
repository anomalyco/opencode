import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Clock, Deferred, Duration, Effect, Equal, Option, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { Server } from "node:http"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"
import { SharedCache } from "../../shared-cache.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.make("digitalocean")
const integrationID = Integration.ID.make("digitalocean")
const methodID = Integration.MethodID.make("browser")
const interval = "10 minutes"

const clientID = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82"
const authorizeEndpoint = "https://cloud.digitalocean.com/v1/oauth/authorize"
const routersEndpoint = "https://api.digitalocean.com/v2/gen-ai/models/routers"
const callbackPort = 1456
const callbackPath = "/auth/callback"
const tokenPath = "/auth/token"
const RoutersResponse = Schema.Struct({
  model_routers: Schema.Array(Schema.Struct({ name: Schema.NonEmptyString })),
})
const decodeCallback = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      access_token: Schema.optional(Schema.String),
      expires_in: Schema.optional(Schema.String),
      state: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String),
      error_description: Schema.optional(Schema.String),
    }),
  ),
)

const oauth = {
  integrationID,
  method: {
    id: methodID,
    type: "oauth",
    label: "Login with DigitalOcean",
  },
  authorize: () =>
    Effect.gen(function* () {
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
      const token = yield* Deferred.make<{ access: string; expiresIn: number }, Error>()
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
            const body = Option.getOrUndefined(decodeCallback(Buffer.concat(chunks).toString("utf8")))
            const error = body?.error_description || body?.error
            const access = body?.access_token
            if (error || !access || body?.state !== state) {
              const message = error || (access ? "Invalid OAuth state" : "Missing access token")
              Effect.runFork(Deferred.fail(token, new Error(message)))
              response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }))
              return
            }
            const expires = Number.parseInt(body.expires_in ?? "0", 10)
            Effect.runFork(
              Deferred.succeed(token, {
                access,
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
        url: `${authorizeEndpoint}?${new URLSearchParams({
          response_type: "token",
          client_id: clientID,
          redirect_uri: redirect,
          scope: "genai:read inference:query",
          state,
        })}`,
        instructions: "Complete authorization in your browser. This window will close automatically.",
        callback: Effect.gen(function* () {
          const payload = yield* Deferred.await(token)
          return Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: payload.access,
            refresh: "",
            expires: (yield* Clock.currentTimeMillis) + payload.expiresIn * 1000,
          })
        }),
      }
    }),
} satisfies IntegrationOAuthMethodRegistration

export const DigitalOceanPlugin = define({
  id: "opencode.provider.digitalocean",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const cache = yield* SharedCache.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const loading = Semaphore.makeUnsafe(1)
    const loaded: { key?: string; routers: (typeof RoutersResponse.Type)["model_routers"] } = { routers: [] }

    const load = Effect.fn("DigitalOceanPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      if (!connection || credential?.type !== "oauth" || credential.methodID !== methodID) {
        const changed = loaded.routers.length > 0
        loaded.key = undefined
        loaded.routers = []
        return changed
      }
      const key = `digitalocean:${IntegrationConnection.key(connection)}`
      const expired = credential.expires !== 0 && credential.expires <= (yield* Clock.currentTimeMillis)
      const result = yield* cache
        .get({
          key,
          // An expired token cannot load again, so it keeps any routers already loaded for the connection.
          maxAge: expired ? Duration.infinity : interval,
          load: Effect.gen(function* () {
            const current = yield* ctx.integration.connection.resolve(connection)
            if (current?.type !== "oauth" || current.methodID !== methodID)
              return yield* Effect.fail(new Error("DigitalOcean connection has no OAuth credential"))
            if (current.expires !== 0 && current.expires <= (yield* Clock.currentTimeMillis))
              return yield* Effect.fail(new Error("DigitalOcean access token expired"))
            const response = yield* http
              .execute(
                HttpClientRequest.get(routersEndpoint).pipe(
                  HttpClientRequest.bearerToken(current.access),
                  HttpClientRequest.acceptJson,
                  HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)),
                ),
              )
              .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(RoutersResponse)), Effect.timeout("10 seconds"))
            return response.model_routers.toSorted((a, b) => a.name.localeCompare(b.name))
          }),
        })
        .pipe(
          Effect.catch((cause) =>
            expired
              ? Effect.undefined
              : Effect.logWarning("failed to sync DigitalOcean routers", { cause }).pipe(Effect.as(undefined)),
          ),
        )
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active(integrationID))
      )
        return false
      const routers = result ?? (loaded.key === key ? loaded.routers : [])
      const changed = !Equal.equals(routers, loaded.routers)
      loaded.key = key
      loaded.routers = routers
      return changed
    })

    yield* ctx.integration.transform((draft) => {
      draft.method.update(oauth)
    })
    yield* ctx.provider.transform((evt) => {
      if (!evt.get(providerID)) return
      for (const router of loaded.routers) {
        const id = `router:${router.name}`
        if (evt.get(providerID)?.models.has(Model.ID.make(id))) continue
        evt.models.update(providerID, id, (draft) => {
          draft.name = router.name
          draft.family = Model.Family.make("digitalocean-inference-routers")
          draft.capabilities = { tools: true, input: ["text"], output: ["text"] }
          draft.limit = { context: 128_000, output: 8_192 }
        })
      }
    })
    const refresh = () =>
      loading.withPermit(load().pipe(Effect.flatMap((changed) => (changed ? ctx.provider.reload() : Effect.void))))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
    yield* Effect.sleep(interval).pipe(Effect.andThen(refresh()), Effect.forever, Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)

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
