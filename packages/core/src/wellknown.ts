export * as WellKnown from "./wellknown"

import { Integration } from "@opencode-ai/schema/integration"
import { Context, Effect, Layer, Ref, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { isDeepStrictEqual } from "node:util"
import { makeGlobalNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"
import { EventV2 } from "./event"
import { KV } from "./kv"

export interface Auth extends Schema.Schema.Type<typeof Auth> {}
export const Auth = Schema.Struct({
  command: Schema.Array(Schema.String),
  env: Schema.String,
}).annotate({ identifier: "WellKnown.Auth" })

export interface RemoteConfig extends Schema.Schema.Type<typeof RemoteConfig> {}
export const RemoteConfig = Schema.Struct({
  url: Schema.String,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "WellKnown.RemoteConfig" })

export interface Config extends Schema.Schema.Type<typeof Config> {}
export const Config = Schema.Record(Schema.String, Schema.Json).annotate({ identifier: "WellKnown.Config" })

export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}
export const Manifest = Schema.Struct({
  auth: Schema.optional(Auth),
  config: Schema.optional(Schema.NullOr(Config)),
  remote_config: Schema.optional(RemoteConfig),
}).annotate({ identifier: "WellKnown.Manifest" })

export interface ResolveInput {
  readonly origin: string
  readonly variables?: Readonly<Record<string, string>>
}

export interface Entry {
  readonly origin: string
  readonly integrationID: Integration.ID
  readonly manifest: Manifest
}

export interface Interface {
  readonly entries: () => Effect.Effect<readonly Entry[], Error>
  readonly snapshot: () => readonly Entry[]
  readonly refresh: () => Effect.Effect<boolean, Error>
  readonly add: (origin: string) => Effect.Effect<Entry, Error>
  readonly remove: (origin: string) => Effect.Effect<void>
  readonly resolve: (entry: Entry, variables: Readonly<Record<string, string>>) => Effect.Effect<Config[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/WellKnown") {}

export const Event = {
  Updated: EventV2.ephemeral({ type: "wellknown.updated", schema: {} }),
}

export const inspect = Effect.fn("WellKnown.inspect")(function* (origin: string) {
  const url = `${origin.replace(/\/+$/, "")}/.well-known/opencode`
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  return yield* http.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson)).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Manifest)),
    Effect.mapError((cause) => new Error(`Failed to load wellknown manifest from ${url}`, { cause })),
  )
})

export const resolve = Effect.fn("WellKnown.resolve")(function* (input: ResolveInput) {
  const manifest = yield* inspect(input.origin)
  return yield* resolveEntry(
    { origin: input.origin, integrationID: Integration.ID.make(input.origin.replace(/\/+$/, "")), manifest },
    input.variables ?? {},
  )
})

const resolveEntry = Effect.fnUntraced(function* (entry: Entry, variables: Readonly<Record<string, string>>) {
  const configs = entry.manifest.config ? [entry.manifest.config] : []
  if (!entry.manifest.remote_config) return configs

  const substitute = (value: string) =>
    value.replace(/\{env:([^}]+)\}/g, (_, name: string) => variables[name] ?? process.env[name] ?? "")
  const url = substitute(entry.manifest.remote_config.url)
  const headers = Object.fromEntries(
    Object.entries(entry.manifest.remote_config.headers ?? {}).map(([key, value]) => [key, substitute(value)]),
  )
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const remote = yield* http
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.setHeaders(headers)))
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Config)),
      Effect.mapError((cause) => new Error(`Failed to load wellknown remote config from ${url}`, { cause })),
    )
  if (Schema.is(Config)(remote.config)) return [...configs, remote.config]
  return [...configs, remote]
})

const sourcesKey = "wellknown:sources"
const Sources = Schema.Array(Schema.String)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const kv = yield* KV.Service
    const events = yield* EventV2.Service
    const cache = yield* Ref.make(new Map<string, Entry>())
    const lock = Semaphore.makeUnsafe(1)

    const load = Effect.fn("WellKnown.load")(function* () {
      const value = yield* kv.get(sourcesKey)
      const origins = Schema.is(Sources)(value) ? value : []
      const current = yield* Ref.get(cache)
      const entries = yield* Effect.forEach(origins, (origin) => {
        const cached = current.get(origin)
        if (cached) return Effect.succeed(cached)
        return inspect(origin).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
          Effect.map((manifest) => ({ origin, integrationID: Integration.ID.make(origin), manifest })),
        )
      })
      yield* Ref.set(cache, new Map(entries.map((entry) => [entry.origin, entry])))
      return entries
    })

    const refresh = Effect.fn("WellKnown.refresh")(function* () {
      return yield* lock.withPermit(
        Effect.gen(function* () {
          const value = yield* kv.get(sourcesKey)
          const origins = Schema.is(Sources)(value) ? value : []
          if (!origins.length) return false
          const entries = yield* Effect.forEach(origins, (origin) =>
            inspect(origin).pipe(
              Effect.provideService(HttpClient.HttpClient, http),
              Effect.map((manifest) => ({ origin, integrationID: Integration.ID.make(origin), manifest })),
            ),
          )
          const next = new Map(entries.map((entry) => [entry.origin, entry]))
          const changed = !isDeepStrictEqual(Ref.getUnsafe(cache), next)
          if (!changed) return false
          yield* Ref.set(cache, next)
          yield* events.publish(Event.Updated, {})
          return true
        }),
      )
    })

    return Service.of({
      entries: load,
      snapshot: () => Array.from(Ref.getUnsafe(cache).values()),
      refresh,
      add: Effect.fn("WellKnown.add")(function* (value) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const origin = value.replace(/\/+$/, "")
            const manifest = yield* inspect(origin).pipe(Effect.provideService(HttpClient.HttpClient, http))
            if (!manifest.auth) return yield* Effect.fail(new Error(`No authentication method found at ${origin}`))
            const entry = { origin, integrationID: Integration.ID.make(origin), manifest }
            const sources = yield* kv.get(sourcesKey)
            const origins = Schema.is(Sources)(sources) ? sources : []
            yield* kv.set(sourcesKey, Array.from(new Set([...origins, origin])))
            yield* Ref.update(cache, (current) => new Map(current).set(origin, entry))
            yield* events.publish(Event.Updated, {})
            return entry
          }),
        )
      }),
      remove: Effect.fn("WellKnown.remove")(function* (value) {
        yield* lock.withPermit(
          Effect.gen(function* () {
            const origin = value.replace(/\/+$/, "")
            const sources = yield* kv.get(sourcesKey)
            const origins = Schema.is(Sources)(sources) ? sources : []
            yield* kv.set(
              sourcesKey,
              origins.filter((item) => item !== origin),
            )
            yield* Ref.update(cache, (current) => {
              const next = new Map(current)
              next.delete(origin)
              return next
            })
            yield* events.publish(Event.Updated, {})
          }),
        )
      }),
      resolve: Effect.fn("WellKnown.resolveEntry")(function* (entry, variables) {
        return yield* resolveEntry(entry, variables).pipe(Effect.provideService(HttpClient.HttpClient, http))
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [httpClient, KV.node, EventV2.node] })
