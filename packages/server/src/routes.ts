import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Effect, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { setExtraPlugins } from "@opencode-ai/core/plugin/boot"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Catalog } from "@opencode-ai/core/catalog"

function cliProviderPlugin(providerURL: string, model: string) {
  return {
    id: PluginV2.ID.make("cli-provider"),
    effect: Effect.succeed({
      "catalog.transform": Effect.fn(function* (evt: Catalog.Editor) {
        const providerID = ProviderV2.ID.make("cli")
        evt.provider.update(providerID, (provider) => {
          provider.name = "CLI Provider"
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: providerURL, settings: {} }
          provider.request = { headers: {}, body: {} }
          provider.enabled = { via: "custom", data: {} }
        })
        const modelID = ModelV2.ID.make(model)
        evt.model.update(providerID, modelID, (m) => {
          m.name = model
          m.api = { id: modelID, type: "aisdk", package: "@ai-sdk/openai-compatible", settings: {} }
          m.capabilities = { tools: true, input: ["text"], output: ["text"] }
          m.limit = { output: 4096, context: 32768 }
        })
        evt.model.default.set(providerID, modelID)
      }),
    }),
  }
}

export function createRoutes(password?: string, providerURL?: string, model?: string) {
  if (providerURL && model) {
    setExtraPlugins([cliProviderPlugin(providerURL, model)])
  }
  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.provide(PtyEnvironment.defaultLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(
      password
        ? ServerAuth.Config.layer({ username: "opencode", password: Option.some(password) })
        : ServerAuth.Config.defaultLayer,
    ),
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
