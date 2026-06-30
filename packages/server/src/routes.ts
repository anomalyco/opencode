import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Credential } from "@opencode-ai/core/credential"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { layer as locationLayer } from "./location"
import { sessionLocationLayer } from "./middleware/session-location"

const applicationServices = LayerNode.group([
  Database.node,
  EventV2.node,
  httpClient,
  ToolOutputStore.cleanupNode,
  SessionV2.node,
  PluginRuntime.providerNode,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
])

export function createRoutes(password?: string) {
  return makeRoutes(
    password
      ? ServerAuth.Config.layer({ username: "opencode", password: Option.some(password) })
      : ServerAuth.Config.defaultLayer,
  )
}

export function createEmbeddedRoutes(sdkPlugins?: SdkPlugins.Store) {
  return makeRoutes(ServerAuth.Config.layer({ username: "opencode", password: Option.none() }), sdkPlugins)
}

function makeRoutes<AuthError, AuthServices>(
  auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>,
  sdkPlugins?: SdkPlugins.Store,
) {
  const pluginRuntimeCell = PluginRuntime.makeCell()
  const serviceLayer = AppNodeBuilder.build(
    LayerNode.bind(applicationServices, SessionExecution.node, SessionExecutionLocal.node),
    [
      LayerNode.replace(PluginRuntime.layer, PluginRuntime.layerWithCell(pluginRuntimeCell)),
      LayerNode.replace(PluginRuntime.providerLayer, PluginRuntime.providerLayerWithCell(pluginRuntimeCell)),
      ...(sdkPlugins ? [LayerNode.replace(SdkPlugins.layer, SdkPlugins.layerWithStore(sdkPlugins))] : []),
    ],
  )

  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(auth),
    Layer.provide(serviceLayer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
