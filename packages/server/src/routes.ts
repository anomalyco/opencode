import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { SessionV2 } from "@opencode-ai/core/session"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { V2Api } from "./api"
import { ServerAuth } from "./auth"
import { v2Handlers } from "./handlers"
import { v2AuthorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"

export function createRoutes(password?: string) {
  return HttpApiBuilder.layer(V2Api).pipe(
    Layer.provide(v2Handlers),
    Layer.provide(v2AuthorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(
      password
        ? ServerAuth.Config.layer({ username: "opencode", password: Option.some(password) })
        : ServerAuth.Config.defaultLayer,
    ),
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(PermissionSaved.layer),
    Layer.provide(SessionV2.defaultLayer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
