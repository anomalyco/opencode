import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { NotFoundError } from "@/storage/storage"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ReplyPayload } from "../groups/permission"

const mapNotFound = <A, R>(self: Effect.Effect<A, InstanceType<typeof NotFoundError>, R>) =>
  self.pipe(
    Effect.catch((error: unknown) =>
      NotFoundError.isInstance(error) ? Effect.fail(new HttpApiError.NotFound({})) : Effect.die(error),
    ),
    Effect.catchDefect((error) =>
      NotFoundError.isInstance(error) ? Effect.fail(new HttpApiError.NotFound({})) : Effect.die(error),
    ),
  )

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: typeof ReplyPayload.Type
    }) {
      yield* mapNotFound(
        svc.reply({
          requestID: ctx.params.requestID,
          reply: ctx.payload.reply,
          message: ctx.payload.message,
        }),
      )
      return true
    })

    return handlers.handle("list", list).handle("reply", reply)
  }),
)
