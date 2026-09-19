import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Permission } from "@/permission"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PermissionNotFoundError } from "../errors"
import { PermissionAutoApprove } from "@/permission/auto-approve"
import { Config } from "@/config/config"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service
    const autoApprove = yield* PermissionAutoApprove.Service
    const config = yield* Config.Service

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

    const classify = Effect.fn("PermissionHttpApi.classify")(function* (ctx: {
      params: { requestID: PermissionV1.ID }
    }) {
      const request = (yield* svc.list()).find((item) => item.id === ctx.params.requestID)
      if (!request) {
        return yield* new PermissionNotFoundError({
          requestID: String(ctx.params.requestID),
          message: `Permission request not found: ${ctx.params.requestID}`,
        })
      }
      const result = yield* autoApprove.classify(request)
      if (!result.approved) return result
      if ((yield* svc.list()).some((item) => item === request)) return result
      return { ...result, approved: false }
    })

    const overlay = Effect.fn("PermissionHttpApi.overlay")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: { enabled: boolean }
    }) {
      // Disabling stays available so a client can always release an overlay, even if the
      // beta flag was turned off while the mode was active.
      if (ctx.payload.enabled && (yield* config.get()).experimental?.auto_approve !== true)
        return yield* svc.overlay({ sessionID: ctx.params.sessionID, enabled: false })
      return yield* svc.overlay({ sessionID: ctx.params.sessionID, enabled: ctx.payload.enabled })
    })

    return handlers.handle("list", list).handle("reply", reply).handle("classify", classify).handle("overlay", overlay)
  }),
)
