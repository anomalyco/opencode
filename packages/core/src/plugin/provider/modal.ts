import { Effect, Equal, Semaphore, Stream } from "effect"
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
const interval = "10 minutes"

export const ModalPlugin = define({
  id: "opencode.provider.modal",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const cache = yield* SharedCache.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      baseURL?: string
      models?: ModalModels.Snapshot
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = {}

    const load = Effect.fn("ModalPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("modal")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const apiKey = credential?.type === "key" ? credential.key : process.env.MODAL_PROXY_TOKEN
      const provider = yield* providers.get(providerID)
      const baseURL = typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : undefined
      if (!apiKey || !baseURL) {
        const changed = loaded.baseURL !== undefined || loaded.models !== undefined
        loaded.baseURL = undefined
        loaded.models = undefined
        loaded.connection = undefined
        return changed
      }
      const remote = yield* cache
        .get({
          key: `modal:${credential?.type === "key" ? IntegrationConnection.key(connection) : "env:MODAL_PROXY_TOKEN"}:${baseURL.replace(/\/+$/, "")}`,
          maxAge: interval,
          load: Effect.gen(function* () {
            const current =
              connection && credential?.type === "key"
                ? yield* ctx.integration.connection.resolve(connection)
                : undefined
            const key =
              credential?.type === "key"
                ? current?.type === "key"
                  ? current.key
                  : undefined
                : process.env.MODAL_PROXY_TOKEN
            if (!key) return yield* Effect.fail(new Error("Modal connection has no API key"))
            const models = yield* Effect.tryPromise({
              try: () => ModalModels.load(baseURL, key),
              catch: (cause) => cause,
            })
            return models.toSorted((a, b) => a.id.localeCompare(b.id))
          }),
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to sync Modal models", { cause }).pipe(Effect.as(undefined)),
          ),
        )
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active("modal"))
      )
        return false
      const changed =
        IntegrationConnection.key(connection) !== IntegrationConnection.key(loaded.connection) ||
        baseURL !== loaded.baseURL ||
        !Equal.equals(remote, loaded.models)
      loaded.baseURL = baseURL
      loaded.models = remote
      loaded.connection = connection
      return changed
    })

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
    const refresh = () =>
      loading.withPermit(load().pipe(Effect.flatMap((changed) => (changed ? ctx.provider.reload() : Effect.void))))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("modal")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
    yield* Effect.sleep(interval).pipe(Effect.andThen(refresh()), Effect.forever, Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)
