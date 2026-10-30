import { Effect, Semaphore, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Bus } from "../../bus.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { GmiCloudModels } from "../../gmicloud/models.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.make("gmicloud")
const defaultBaseURL = "https://api.gmi-serving.com/v1"

export const GmiCloudPlugin = define({
  id: "opencode.provider.gmicloud",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      baseURL?: string
      models?: GmiCloudModels.Snapshot
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = {}

    const load = Effect.fn("GmiCloudPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("gmicloud")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const apiKey = credential?.type === "key" ? credential.key : process.env.GMICLOUD_API_KEY
      const provider = yield* providers.get(providerID)
      const baseURL =
        typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : defaultBaseURL
      if (!apiKey) {
        loaded.baseURL = undefined
        loaded.models = undefined
        loaded.connection = undefined
        return
      }
      const remote = yield* Effect.tryPromise({
        try: () => GmiCloudModels.load(baseURL, apiKey),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to sync GMI Cloud models", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active("gmicloud"))
      )
        return
      loaded.baseURL = baseURL
      loaded.models = remote
      loaded.connection = connection
    })

    yield* ctx.provider.transform((evt) => {
      const item = evt.get(providerID)
      if (!item) return
      if (!loaded.models || !loaded.baseURL) return
      evt.add({
        info: item.provider,
        models: Array.from(
          GmiCloudModels.derive(loaded.baseURL, loaded.models, Array.from(item.models.values())).values(),
        ),
        sourceConnection: loaded.connection,
      })
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("gmicloud")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
  }),
} satisfies PluginInternal.InternalPlugin)
