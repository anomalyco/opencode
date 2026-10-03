import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "@/permission"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PermissionAutoLeaseNotFoundError, PermissionNotFoundError } from "../errors"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
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

    const autoList = Effect.fn("PermissionHttpApi.autoList")(function* () {
      return yield* svc.autoList()
    })

    const autoAcquire = Effect.fn("PermissionHttpApi.autoAcquire")(function* (ctx: {
      payload: PermissionV1.AutoAcquireBody
    }) {
      return yield* svc.autoAcquire(ctx.payload)
    })

    const autoRenew = Effect.fn("PermissionHttpApi.autoRenew")(function* (ctx: {
      params: { leaseID: PermissionV1.AutoLeaseID }
    }) {
      return yield* svc.autoRenew(ctx.params.leaseID).pipe(
        Effect.catchTag("Permission.AutoLeaseNotFoundError", (error) =>
          Effect.fail(
            new PermissionAutoLeaseNotFoundError({
              leaseID: String(error.leaseID),
              message: `Permission auto lease not found: ${error.leaseID}`,
            }),
          ),
        ),
      )
    })

    const autoRelease = Effect.fn("PermissionHttpApi.autoRelease")(function* (ctx: {
      params: { leaseID: PermissionV1.AutoLeaseID }
    }) {
      return yield* svc.autoRelease(ctx.params.leaseID)
    })

    return handlers
      .handle("list", list)
      .handle("autoList", autoList)
      .handle("autoAcquire", autoAcquire)
      .handle("autoRenew", autoRenew)
      .handle("autoRelease", autoRelease)
      .handle("reply", reply)
  }),
)
