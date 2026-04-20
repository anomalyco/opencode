import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/permission"

class PermissionNotFoundError extends Schema.TaggedErrorClass<PermissionNotFoundError>()(
  "PermissionNotFoundError",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

export const PermissionApi = HttpApi.make("permission")
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
        })
          .addError(PermissionNotFoundError)
          .annotateMerge(
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

export const permissionHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Permission.ReplyBody
    }) {
      const pending = yield* svc.list()
      const request = pending.find((r) => r.id === ctx.params.requestID)
      if (!request) {
        return yield* Effect.fail(new PermissionNotFoundError({ message: "Permission request not found" }))
      }
      yield* svc.reply({
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        message: ctx.payload.message,
      })
      return true
    })

    return HttpApiBuilder.group(PermissionApi, "permission", (handlers) =>
      handlers.handle("list", list).handle("reply", reply),
    )
  }),
).pipe(Layer.provide(Permission.defaultLayer))
