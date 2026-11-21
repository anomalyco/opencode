import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { Duration, Effect, FiberSet, Option, Schedule, type Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import photonWasm from "#photon-wasm"
import { Config } from "../../config.js"
import { Environment } from "../../environment/index.js"
import { EnvironmentUnavailable } from "../../environment/unavailable.js"
import { Location } from "../../location.js"
import { Model } from "../../model.js"
import type { PluginInternal } from "../internal.js"
import { foldSettings } from "./configured.js"
import { activeCredential } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"

export type LocalModel = {
  readonly id: string
  readonly name?: string
  readonly family?: string | null
  readonly tools?: boolean
  readonly vision?: boolean
  readonly context?: number | null
  /** Decision models answer typed questions through the host's System One endpoint (`/v1/systemone`). */
  readonly type?: "chat" | "decision"
}

// Remote and tunnelled hosts can take several seconds to connect. Discovery runs in the background, so waiting
// only delays when the models appear.
const requestTimeout = "15 seconds"

export type LocalDiscoveryClient = ReturnType<typeof createClient>

export function createLocalProviderPlugin<Discovered>(input: {
  readonly id: string
  readonly providerID: string
  readonly name: string
  readonly origin: string
  readonly stripPathSuffix?: RegExp
  readonly discover: (client: LocalDiscoveryClient) => Effect.Effect<readonly Discovered[], unknown>
  readonly model: (item: NoInfer<Discovered>) => LocalModel
}) {
  const discovery = new Map<string, { checked: number; apiKey?: string; models?: readonly Discovered[] }>()
  // One lock per endpoint, so an unresponsive host does not delay discovery of another.
  const discoveryLocks = new Map<string, Semaphore.Semaphore>()
  const suffix = input.stripPathSuffix ?? /\/v1$/

  return function make(origin?: string, interval: Duration.Input = "30 seconds") {
    return define({
      id: input.id,
      effect: Effect.fn(function* (ctx) {
        const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
        const config = yield* Config.Service
        const environment = yield* Effect.serviceOption(Environment.Service)
        const location = yield* Effect.serviceOption(Location.Service)
        const defaultOrigin =
          origin ??
          (photonWasm === "" ||
          (Option.isSome(location) && location.value.workspaceID !== undefined) ||
          (Option.isSome(environment) && environment.value.spawner === EnvironmentUnavailable.spawner)
            ? undefined
            : input.origin)
        const source = { current: configured(yield* config.entries(), input.providerID, defaultOrigin, suffix) }
        const loaded = { models: [] as readonly Discovered[], connected: false, hash: "[]", failing: false }

        yield* ctx.integration.transform((integrations) => {
          // A key connection lives on the integration (env keys only exist while it does), so keep it then.
          if (loaded.models.length === 0 || loaded.connected) return
          integrations.remove(input.providerID)
        })

        yield* ctx.provider.transform((providers) => {
          if (loaded.models.length === 0) return
          for (const model of providers.get(input.providerID)?.models.values() ?? []) {
            providers.models.remove(input.providerID, model.id)
          }
          providers.update(input.providerID, (provider) => {
            provider.name = input.name
            provider.activation = "enabled"
            provider.package = "@opencode/ai/providers/openai-compatible"
            provider.settings = {
              baseURL: source.current.baseURL,
              provider: input.providerID,
              apiKey: source.current.apiKey ?? "",
            }
            if (!loaded.connected) provider.integrationID = undefined
          })
          for (const item of loaded.models) {
            const spec = input.model(item)
            providers.models.update(input.providerID, spec.id, (model) => {
              model.modelID = Model.ID.make(spec.id)
              model.name = spec.name || spec.id
              model.family = spec.family ? Model.Family.make(spec.family) : undefined
              model.capabilities = {
                tools: spec.tools ?? false,
                input: ["text", ...(spec.vision ? ["image"] : [])],
                output: ["text"],
              }
              if (typeof spec.context === "number" && spec.context > 0) model.limit.context = spec.context
              if (spec.type !== "decision") return
              model.type = "decision"
              model.package = "@opencode/ai/providers/openai-compatible/decisions"
              model.capabilities.output = ["decision"]
            })
          }
        })

        const discover = Effect.fn("LocalProviderPlugin.discover")(function* () {
          const current = source.current
          if (!current.endpoint) return undefined
          const lock = discoveryLocks.get(current.root) ?? Semaphore.makeUnsafe(1)
          discoveryLocks.set(current.root, lock)
          return yield* lock.withPermit(
            Effect.gen(function* () {
              // A key saved with /connect or set in the integration's env var wins over config, as it does for requests.
              const active = yield* activeCredential(ctx, input.providerID)
              const connected = active.connection !== undefined
              const apiKey = active.credential?.type === "key" ? active.credential.key : current.apiKey
              const cached = discovery.get(current.root)
              if (cached && cached.apiKey === apiKey && Date.now() - cached.checked < Duration.toMillis(interval))
                return { source: current, connected, models: cached.models }
              discovery.set(current.root, {
                checked: Date.now(),
                apiKey,
                models: cached && cached.apiKey === apiKey ? cached.models : undefined,
              })
              const models = yield* input.discover(createClient(http, current.root, apiKey, current.endpoint))
              discovery.set(current.root, { checked: Date.now(), apiKey, models })
              return { source: current, connected, models }
            }),
          )
        })

        const refresh = Effect.fn("LocalProviderPlugin.refresh")(function* () {
          const result = yield* discover()
          loaded.failing = false
          if (!result?.models || result.source !== source.current) return
          const hash = JSON.stringify([result.connected, result.models])
          if (hash === loaded.hash) return
          loaded.models = result.models
          loaded.connected = result.connected
          loaded.hash = hash
          yield* ctx.integration.reload()
          yield* ctx.provider.reload()
        })

        // Keep the last successful inventory through transient outages instead of flickering model availability.
        // Only a configured endpoint is expected to answer, and it is reported once per outage.
        // A reload doesn't wait for the attempt in flight, so a failure for a replaced source is dropped.
        const attempt = Effect.suspend(() => {
          const current = source.current
          return refresh().pipe(
            Effect.catch((cause) => {
              if (current !== source.current || !current.explicit || loaded.failing) return Effect.void
              loaded.failing = true
              return Effect.logWarning(`failed to discover ${input.name} models`, {
                baseURL: current.baseURL,
                cause,
              })
            }),
          )
        })
        yield* attempt.pipe(Effect.repeat(Schedule.spaced(interval)), Effect.forkScoped)
        // Event handlers start discovery without waiting on it, so a slow endpoint doesn't hold up the next event.
        const background = yield* FiberSet.make()
        yield* ProviderRefresh.onSwitch(input.providerID, FiberSet.run(background, attempt))
        const reload = Effect.fn("LocalProviderPlugin.reload")(function* () {
          const next = configured(yield* config.entries(), input.providerID, defaultOrigin, suffix)
          if (
            next.baseURL === source.current.baseURL &&
            next.apiKey === source.current.apiKey &&
            next.root === source.current.root
          )
            return
          source.current = next
          loaded.models = []
          loaded.connected = false
          loaded.hash = "[]"
          loaded.failing = false
          yield* ctx.integration.reload()
          yield* ctx.provider.reload()
          yield* FiberSet.run(background, attempt)
        })
        yield* ctx.event
          .subscribe({ types: ["config.updated"] })
          .pipe(Stream.runForEach(reload), Effect.forkScoped({ startImmediately: true }))
      }),
    } satisfies PluginInternal.InternalPlugin)
  }
}

function createClient(
  http: HttpClient.HttpClient,
  root: string,
  apiKey: string | undefined,
  endpoint: (path: string) => string,
) {
  const auth = (request: HttpClientRequest.HttpClientRequest) =>
    apiKey
      ? request.pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(apiKey))
      : request.pipe(HttpClientRequest.acceptJson)
  return {
    root,
    apiKey,
    get: (path: string) =>
      http.execute(auth(HttpClientRequest.get(endpoint(path)))).pipe(Effect.timeout(requestTimeout)),
    getJson: <A, I>(path: string, schema: Schema.Codec<A, I>) =>
      http
        .execute(auth(HttpClientRequest.get(endpoint(path))))
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)), Effect.timeout(requestTimeout)),
    postJson: <B, BI, A, AI>(
      path: string,
      bodySchema: Schema.Codec<B, BI>,
      body: B,
      responseSchema: Schema.Codec<A, AI>,
    ) =>
      auth(HttpClientRequest.post(endpoint(path))).pipe(
        HttpClientRequest.schemaBodyJson(bodySchema)(body),
        Effect.flatMap(http.execute),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(responseSchema)),
        Effect.timeout(requestTimeout),
      ),
  }
}

function configured(entries: readonly Entry[], providerID: string, origin: string | undefined, suffix: RegExp) {
  const settings = foldSettings(entries, providerID, undefined)
  const baseURL = (
    typeof settings?.baseURL === "string"
      ? settings.baseURL
      : origin !== undefined
        ? `${origin.replace(/\/+$/, "")}/v1`
        : ""
  ).replace(/\/+$/, "")
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey : undefined
  const explicit = typeof settings?.baseURL === "string"
  if (!URL.canParse(baseURL)) return { baseURL, apiKey, explicit }
  const url = new URL(baseURL)
  if (url.protocol !== "http:" && url.protocol !== "https:") return { baseURL, apiKey, explicit }
  const prefix = url.pathname.replace(/\/+$/, "").replace(suffix, "")
  const endpoint = (path: string) => {
    const next = new URL(url)
    next.pathname = `${prefix}${path}`
    next.search = ""
    next.hash = ""
    return next.toString()
  }
  return { baseURL, apiKey, explicit, root: endpoint(""), endpoint }
}
