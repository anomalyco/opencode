import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { define } from "@opencode/plugin/effect/plugin"
import { IntegrationConnection } from "../../integration/connection.js"
import { ModalModels } from "../../modal/models.js"
import { Provider } from "../../provider.js"
import { SharedCache } from "../../shared-cache.js"
import type { PluginInternal } from "../internal.js"
import { ProviderRefresh } from "./refresh.js"

const providerID = Provider.ID.make("modal")

export const ModalPlugin = define({
  id: "opencode.provider.modal",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const cache = yield* SharedCache.Service
    const http = yield* HttpClient.HttpClient
    const discovered = yield* ProviderRefresh.start({
      integrationID: "modal",
      initial: {} as {
        readonly baseURL?: string
        readonly models?: ModalModels.Snapshot
        readonly connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
      },
      active: ctx.integration.connection.active("modal"),
      reload: ctx.provider.reload(),
      load: Effect.fn("ModalPlugin.load")(function* (_, options) {
        const connection = yield* ctx.integration.connection.active("modal")
        const credential = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        const apiKey = credential?.type === "key" ? credential.key : process.env.MODAL_PROXY_TOKEN
        const provider = yield* providers.get(providerID)
        const baseURL = typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : undefined
        if (!apiKey || !baseURL) return { connection, value: {} }
        const models = yield* cache
          .get({
            key: modelsKey(connection, apiKey, baseURL),
            ...options,
            load: (connection ? ctx.integration.connection.resolve(connection) : Effect.undefined).pipe(
              Effect.map((current) =>
                current?.type === "key" ? current.key : connection ? undefined : process.env.MODAL_PROXY_TOKEN,
              ),
              Effect.flatMap((key) =>
                key ? ModalModels.load(http, baseURL, key) : Effect.fail(new Error("Modal connection has no API key")),
              ),
              Effect.map((models) => models.toSorted((a, b) => a.id.localeCompare(b.id))),
            ),
          })
          .pipe(Effect.orElseSucceed(() => undefined))
        return { connection, value: { baseURL, models, connection } }
      }),
    })

    yield* ctx.provider.transform((evt) => {
      const item = evt.get(providerID)
      const loaded = discovered.current
      if (!item || !loaded.models || !loaded.baseURL) return
      evt.add({
        info: item.provider,
        models: Array.from(
          ModalModels.derive(loaded.baseURL, loaded.models, Array.from(item.models.values())).values(),
        ),
        sourceConnection: loaded.connection,
      })
    })
  }),
} satisfies PluginInternal.InternalPlugin)

function modelsKey(connection: Parameters<typeof IntegrationConnection.key>[0], apiKey: string, baseURL: string) {
  const access = IntegrationConnection.key(connection) ?? "env:MODAL_PROXY_TOKEN"
  return `modal:${access}:${SharedCache.fingerprint(apiKey)}:${baseURL.replace(/\/+$/, "")}`
}
