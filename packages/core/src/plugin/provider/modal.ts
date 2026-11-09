import { Effect, Option, Stream } from "effect"
import { HttpClient } from "effect/http"
import { define } from "@opencode/plugin/effect/plugin"
import { IntegrationConnection } from "../../integration/connection.js"
import { ModalModels } from "../../modal/models.js"
import { Provider } from "../../provider.js"
import { SharedCache } from "../../shared-cache.js"
import type { PluginInternal } from "../internal.js"
import { activeCredential } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"

const providerID = Provider.ID.make("modal")

export const ModalPlugin = define({
  id: "opencode.provider.modal",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const cache = yield* SharedCache.Service
    const http = yield* HttpClient.HttpClient
    const discovered: {
      baseURL?: string
      models?: ModalModels.Snapshot
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = {}

    yield* ProviderRefresh.follow({
      integrationID: "modal",
      select: Effect.gen(function* () {
        const { connection, credential } = yield* activeCredential(ctx, "modal")
        const apiKey = credential?.type === "key" ? credential.key : process.env.MODAL_PROXY_TOKEN
        const provider = yield* providers.get(providerID)
        const baseURL = typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : undefined
        if (!apiKey || !baseURL)
          return { key: `none:${IntegrationConnection.key(connection)}`, acquire: () => apply({ connection }) }
        const key = modelsKey(connection, apiKey, baseURL)
        return {
          key,
          acquire: (current: () => boolean) =>
            Effect.gen(function* () {
              const models = yield* cache.source({
                key,
                load: (connection ? ctx.integration.connection.resolve(connection) : Effect.undefined).pipe(
                  Effect.map((current) =>
                    current?.type === "key" ? current.key : connection ? undefined : process.env.MODAL_PROXY_TOKEN,
                  ),
                  Effect.flatMap((key) =>
                    key
                      ? ModalModels.load(http, baseURL, key)
                      : Effect.fail(new Error("Modal connection has no API key")),
                  ),
                  Effect.map((models) => models.toSorted((a, b) => a.id.localeCompare(b.id))),
                ),
              })
              yield* models.changes.pipe(
                Stream.runForEach((state) =>
                  current() ? apply({ baseURL, models: Option.getOrUndefined(state.value), connection }) : Effect.void,
                ),
                Effect.forkScoped({ startImmediately: true }),
              )
            }),
        }
      }),
    })

    // Reloads providers only when what the transform reads changed.
    function apply(next: typeof discovered) {
      if (
        next.baseURL === discovered.baseURL &&
        next.models === discovered.models &&
        IntegrationConnection.key(next.connection) === IntegrationConnection.key(discovered.connection)
      )
        return Effect.void
      discovered.baseURL = next.baseURL
      discovered.models = next.models
      discovered.connection = next.connection
      return ctx.provider.reload()
    }

    yield* ctx.provider.transform((evt) => {
      const item = evt.get(providerID)
      if (!item || !discovered.models || !discovered.baseURL) return
      evt.add({
        info: item.provider,
        models: Array.from(
          ModalModels.derive(discovered.baseURL, discovered.models, Array.from(item.models.values())).values(),
        ),
        sourceConnection: discovered.connection,
      })
    })
  }),
} satisfies PluginInternal.InternalPlugin)

function modelsKey(connection: Parameters<typeof IntegrationConnection.key>[0], apiKey: string, baseURL: string) {
  const access = IntegrationConnection.key(connection) ?? "env:MODAL_PROXY_TOKEN"
  return `modal:${access}:${SharedCache.fingerprint(apiKey)}:${baseURL.replace(/\/+$/, "")}`
}
