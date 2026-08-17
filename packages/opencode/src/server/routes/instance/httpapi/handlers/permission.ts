import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "@/permission"
import { PermissionValidator } from "@/permission/validator"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PermissionNotFoundError } from "../errors"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service
    const validator = yield* PermissionValidator.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const validatorHealth = Effect.fn("PermissionHttpApi.validatorHealth")(function* () {
      return yield* validator.health()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionV1.ID }
      payload: PermissionV1.ReplyBody
    }) {
      yield* svc
        .reply({
          requestID: ctx.params.requestID,
          reply: ctx.payload.reply,
          message: ctx.payload.message,
        })
        .pipe(
          Effect.catchTag("Permission.NotFoundError", (error) =>
            Effect.fail(
              new PermissionNotFoundError({
                requestID: String(error.requestID),
                message: `Permission request not found: ${error.requestID}`,
              }),
            ),
          ),
        )
      return true
    })

    return handlers.handle("list", list).handle("reply", reply).handle("validatorHealth", validatorHealth)
  }),
)
