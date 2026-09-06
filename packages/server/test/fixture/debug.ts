import { NodeHttpServer } from "@effect/platform-node"
import { Global } from "@opencode-ai/util/global"
import { Layer, Option } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../../src/api"
import { ServerAuth } from "../../src/auth"
import { DebugHandler } from "../../src/handlers/debug"
import { HealthHandler } from "../../src/handlers/health"
import { authorizationLayer } from "../../src/middleware/authorization"
import { schemaErrorLayer } from "../../src/middleware/schema-error"
import { ServerInfo } from "../../src/server-info"

export function debugHandler(log: string) {
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(HttpApi.make("server").add(Api.groups["server.debug"]).add(Api.groups["server.health"])).pipe(
      Layer.provide(
        Layer.merge(DebugHandler, HealthHandler).pipe(
          Layer.provide(Layer.succeed(Global.Service, Global.make({ log }))),
          Layer.provideMerge(authorizationLayer),
          Layer.provideMerge(schemaErrorLayer),
          Layer.provide(ServerAuth.Config.configLayer({ password: Option.some("secret") })),
        ),
      ),
      HttpRouter.provideRequest(ServerInfo.layer(() => [], { version: "heap-test" })),
      Layer.provide(NodeHttpServer.layerHttpServices),
    ),
    { disableLogger: true },
  )
}
