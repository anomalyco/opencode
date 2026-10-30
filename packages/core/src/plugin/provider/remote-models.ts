import { Effect, Semaphore, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

export function createRemoteModelsPlugin<Snapshot>(input: {
  readonly id: string
  readonly providerID: string
  readonly env: string
  readonly label?: string
  readonly defaultBaseURL?: string
  readonly load: (baseURL: string, apiKey: string) => Promise<Snapshot>
  readonly derive: (
    baseURL: string,
    remote: Snapshot,
    existing: readonly Model.Info[],
  ) => Map<Model.ID, Model.Info>
}) {
  const providerID = Provider.ID.make(input.providerID)
  const integrationID = Integration.ID.make(input.providerID)

  return define({
    id: input.id,
    effect: Effect.fn(function* (ctx) {
      const providers = yield* Provider.Service
      const bus = yield* Bus.Service
      const loading = Semaphore.makeUnsafe(1)
      const loaded: {
        baseURL?: string
        models?: Snapshot
        connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
      } = {}

      const load = Effect.fn("RemoteModelsPlugin.load")(function* () {
        const connection = yield* ctx.integration.connection.active(integrationID)
        const credential = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        const apiKey = credential?.type === "key" ? credential.key : process.env[input.env]
        const provider = yield* providers.get(providerID)
        const baseURL =
          typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : (input.defaultBaseURL ?? "")
        if (!apiKey || (!baseURL && input.defaultBaseURL === undefined)) {
          loaded.baseURL = undefined
          loaded.models = undefined
          loaded.connection = undefined
          return
        }
        const remote = yield* Effect.tryPromise({
          try: () => input.load(baseURL, apiKey),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning(`failed to sync ${input.label ?? input.providerID} models`, { cause }).pipe(
              Effect.as(undefined),
            ),
          ),
        )
        if (
          IntegrationConnection.key(connection) !==
          IntegrationConnection.key(yield* ctx.integration.connection.active(integrationID))
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
          models: Array.from(input.derive(loaded.baseURL, loaded.models, Array.from(item.models.values())).values()),
          sourceConnection: loaded.connection,
        })
      })
      const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filter((event) => event.data.integrationID === integrationID),
        Stream.runForEach(refresh),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* refresh().pipe(Effect.forkScoped)
    }),
  }) satisfies PluginInternal.InternalPlugin
}
