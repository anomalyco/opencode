import { Effect, Equal, FiberHandle, Semaphore, Stream } from "effect"
import { HttpClient } from "effect/http"
import { define } from "@opencode/plugin/effect/plugin"
import { Bus } from "../../bus.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { ModalModels } from "../../modal/models.js"
import { Provider } from "../../provider.js"
import { SharedCache } from "../../shared-cache.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.make("modal")

export const ModalPlugin = define({
  id: "opencode.provider.modal",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const cache = yield* SharedCache.Service
    const http = yield* HttpClient.HttpClient
    const loading = Semaphore.makeUnsafe(1)
    const discovery = yield* FiberHandle.make<void, never>()
    const loaded: {
      baseURL: string | undefined
      models: ModalModels.Snapshot | undefined
      connection: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = { baseURL: undefined, models: undefined, connection: undefined }

    const load = Effect.fn("ModalPlugin.load")(function* (since?: number) {
      const connection = yield* ctx.integration.connection.active("modal")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const apiKey = credential?.type === "key" ? credential.key : process.env.MODAL_PROXY_TOKEN
      const provider = yield* providers.get(providerID)
      const baseURL = typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : undefined
      if (!apiKey || !baseURL) return yield* apply(connection, { baseURL: undefined, models: undefined, connection })
      const remote = yield* cache
        .get({
          key: `modal:${IntegrationConnection.key(connection) ?? "env:MODAL_PROXY_TOKEN"}:${SharedCache.fingerprint(apiKey)}:${baseURL.replace(/\/+$/, "")}`,
          maxAge: SharedCache.interval,
          since,
          load: (connection ? ctx.integration.connection.resolve(connection) : Effect.undefined).pipe(
            Effect.map((current) => (current?.type === "key" ? current.key : process.env.MODAL_PROXY_TOKEN)),
            Effect.flatMap((key) =>
              key ? ModalModels.load(baseURL, key) : Effect.fail(new Error("Modal connection has no API key")),
            ),
            Effect.map((models) => models.toSorted((a, b) => a.id.localeCompare(b.id))),
            Effect.provideService(HttpClient.HttpClient, http),
          ),
        })
        .pipe(Effect.orElseSucceed(() => undefined))
      yield* apply(connection, { baseURL, models: remote, connection })
    })

    const apply = (connection: typeof loaded.connection, next: typeof loaded) =>
      loading
        .withPermit(
          Effect.gen(function* () {
            if (
              IntegrationConnection.key(connection) !==
              IntegrationConnection.key(yield* ctx.integration.connection.active("modal"))
            )
              return
            if (Equal.equals(next, loaded)) return
            Object.assign(loaded, next)
            yield* ctx.provider.reload()
          }),
        )
        .pipe(Effect.uninterruptible)

    yield* ctx.provider.transform((evt) => {
      const item = evt.get(providerID)
      if (!item) return
      if (!loaded.models || !loaded.baseURL) return
      evt.add({
        info: item.provider,
        models: Array.from(
          ModalModels.derive(loaded.baseURL, loaded.models, Array.from(item.models.values())).values(),
        ),
        sourceConnection: loaded.connection,
      })
    })
    // A switch replaces whatever refresh is waiting; the timer only starts one when none is running.
    const refresh = (since?: number) => FiberHandle.run(discovery, load(since), { onlyIfMissing: since === undefined })
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("modal")),
      Stream.runForEach((event) => refresh(event.created)),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()
    yield* Effect.sleep(SharedCache.interval).pipe(Effect.andThen(refresh()), Effect.forever, Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)
