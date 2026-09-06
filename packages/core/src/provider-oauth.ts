export * as ProviderOAuth from "./provider-oauth.js"

import { isDeepStrictEqual } from "node:util"
import { AIError, AuthenticationError } from "@opencode-ai/ai"
import type { RequestExecutor } from "@opencode-ai/ai/route"
import { ConfigProvider } from "@opencode-ai/schema/config/provider"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { Clock, Context, Effect, Layer, Redacted, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "./config.js"
import { Provider } from "./provider.js"

const Token = Schema.Struct({
  access_token: Schema.NonEmptyString,
  token_type: Schema.String.check(Schema.isPattern(/^bearer$/i)),
  expires_in: Schema.Finite.check(Schema.isGreaterThan(0)).pipe(Schema.optionalKey),
})

export interface Interface {
  readonly get: (providerID: Provider.ID) => Effect.Effect<RequestExecutor.HttpMiddleware | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderOAuth") {}

export const make = Effect.fn("ProviderOAuth.make")(function* (providerID: Provider.ID, config: ConfigProvider.OAuth) {
  const http = yield* HttpClient.HttpClient
  const lock = yield* Semaphore.make(1)
  const state: { token?: { access: Redacted.Redacted; expires: number } } = {}
  const failure = (message: string) =>
    new AIError({ reason: new AuthenticationError({ message: `OAuth for ${providerID}: ${message}` }) })

  const token = (rejected?: string) =>
    lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (state.token && state.token.expires > now && Redacted.value(state.token.access) !== rejected)
          return state.token.access
        state.token = undefined
        const request = HttpClientRequest.post(config.tokenUrl).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyUrlParams({
            grant_type: "client_credentials",
            scope: config.scope,
            audience: config.audience,
            resource: config.resource,
            ...(config.clientAuthMethod === "client_secret_post"
              ? { client_id: config.clientId, client_secret: config.clientSecret }
              : {}),
          }),
        )
        const response = yield* http.execute(
          config.clientAuthMethod === "client_secret_post"
            ? request
            : HttpClientRequest.basicAuth(request, formEncode(config.clientId), formEncode(config.clientSecret)),
        )
        if (response.status < 200 || response.status >= 300) {
          yield* Stream.runDrain(response.stream).pipe(Effect.ignore)
          return yield* failure(`token endpoint returned HTTP ${response.status}`)
        }
        const result = yield* HttpClientResponse.schemaBodyJson(Token)(response).pipe(
          Effect.mapError(() => failure("token endpoint returned an invalid bearer token")),
        )
        const lifetime = (result.expires_in ?? 0) * 1000
        state.token = {
          access: Redacted.make(result.access_token),
          expires: now + lifetime - Math.min(30_000, lifetime / 10),
        }
        return state.token.access
      }).pipe(
        Effect.timeout("10 seconds"),
        // HTTP and schema errors can contain the client secret or token response.
        Effect.mapError((error) => (error instanceof AIError ? error : failure("token request failed"))),
      ),
    )

  const middleware: RequestExecutor.HttpMiddleware = (request, handler) =>
    Effect.gen(function* () {
      const access = yield* token()
      const authenticated = request.pipe(
        HttpClientRequest.removeHeader("api-key"),
        HttpClientRequest.removeHeader("x-api-key"),
        HttpClientRequest.removeHeader("x-goog-api-key"),
        HttpClientRequest.bearerToken(access),
      )
      const response = yield* handler(authenticated)
      const challenge = response.headers["www-authenticate"] ?? ""
      if (
        response.status !== 401 &&
        !(response.status >= 400 && /\bBearer\b/i.test(challenge) && /\berror\s*=\s*"?invalid_token\b/i.test(challenge))
      )
        return response
      yield* Stream.runDrain(response.stream).pipe(Effect.ignore)
      const refreshed = yield* token(Redacted.value(access))
      return yield* handler(HttpClientRequest.bearerToken(authenticated, refreshed))
    })
  return middleware
})

function formEncode(value: string) {
  return new URLSearchParams({ value }).toString().slice("value=".length)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const http = yield* HttpClient.HttpClient
    const cache = new Map<Provider.ID, { config: ConfigProvider.OAuth; middleware: RequestExecutor.HttpMiddleware }>()
    return Service.of({
      get: Effect.fn("ProviderOAuth.get")(function* (providerID) {
        const configured = (yield* config.entries())
          .filter((entry) => entry.type === "document")
          .map((entry) => entry.info.providers?.[providerID]?.oauth)
          .findLast((oauth) => oauth !== undefined)
        if (!configured) {
          cache.delete(providerID)
          return
        }
        const current = cache.get(providerID)
        if (current && isDeepStrictEqual(current.config, configured)) return current.middleware
        const middleware = yield* make(providerID, configured).pipe(Effect.provideService(HttpClient.HttpClient, http))
        cache.set(providerID, { config: configured, middleware })
        return middleware
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, httpClient] })
