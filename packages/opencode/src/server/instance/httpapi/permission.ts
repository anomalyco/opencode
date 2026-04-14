import { AppLayer } from "@/effect/app-runtime"
import { memoMap } from "@/effect/run-service"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { lazy } from "@/util/lazy"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import type { Handler } from "hono"

const root = "/experimental/httpapi/permission"

const Api = HttpApi.make("permission")
  .add(
    HttpApiGroup.make("permission")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: Schema.Array(Permission.Request),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.list",
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: PermissionID },
          payload: Permission.ReplyBody,
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.reply",
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "permission",
          description: "Experimental HttpApi permission routes.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

const list = Effect.fn("PermissionHttpApi.list")(function* () {
  const svc = yield* Permission.Service
  return yield* svc.list()
})

const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
  params: { requestID: PermissionID }
  payload: Permission.ReplyBody
}) {
  const svc = yield* Permission.Service
  yield* svc.reply({
    requestID: ctx.params.requestID,
    reply: ctx.payload.reply,
    message: ctx.payload.message,
  })
  return true
})

const PermissionLive = HttpApiBuilder.group(Api, "permission", (handlers) =>
  handlers.handle("list", list).handle("reply", reply),
)

const web = lazy(() =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      AppLayer,
      HttpApiBuilder.layer(Api, { openapiPath: `${root}/doc` }).pipe(
        Layer.provide(PermissionLive),
        Layer.provide(HttpServer.layerServices),
      ),
    ),
    {
      disableLogger: true,
      memoMap,
    },
  ),
)

export const PermissionHttpApiHandler: Handler = (c, _next) => web().handler(c.req.raw)
