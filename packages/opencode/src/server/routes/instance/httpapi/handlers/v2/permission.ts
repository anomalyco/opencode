import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { PermissionNotFoundError, SessionNotFoundError } from "../../errors"

function missingRequest(id: PermissionV2.ID) {
  return new PermissionNotFoundError({ requestID: id, message: `Permission request not found: ${id}` })
}

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.permission", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "permissionRequests",
      Effect.fn(function* () {
        return yield* (yield* PermissionV2.Service).list()
      }),
    )
  }),
)

export const sessionPermissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.session.permission", (handlers) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const locations = yield* LocationServiceMap

    const withSessionPermission = Effect.fnUntraced(function* <A, E>(
      sessionID: Parameters<PermissionV2.Interface["forSession"]>[0],
      use: (permission: PermissionV2.Interface) => Effect.Effect<A, E>,
    ) {
      const row = yield* db
        .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row)
        return yield* new SessionNotFoundError({
          sessionID,
          message: `Session not found: ${sessionID}`,
        })

      return yield* Effect.gen(function* () {
        return yield* use(yield* PermissionV2.Service)
      }).pipe(
        Effect.scoped,
        Effect.provide(
          locations.get({ directory: AbsolutePath.make(row.directory), workspaceID: row.workspaceID ?? undefined }),
        ),
      )
    })

    return handlers
      .handle(
        "sessionPermissionRequests",
        Effect.fn(function* (ctx) {
          return yield* withSessionPermission(ctx.params.sessionID, (permission) =>
            permission.forSession(ctx.params.sessionID),
          )
        }),
      )
      .handle(
        "permissionRequestReply",
        Effect.fn(function* (ctx) {
          yield* withSessionPermission(ctx.params.sessionID, (permission) =>
            Effect.gen(function* () {
              const request = yield* permission.get(ctx.params.requestID)
              if (!request || request.sessionID !== ctx.params.sessionID)
                return yield* missingRequest(ctx.params.requestID)
              yield* permission
                .reply({ requestID: ctx.params.requestID, reply: ctx.payload.reply, message: ctx.payload.message })
                .pipe(Effect.catchTag("PermissionV2.NotFoundError", () => missingRequest(ctx.params.requestID)))
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)

export const savedPermissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.permission.saved", (handlers) =>
  Effect.gen(function* () {
    const saved = yield* PermissionSaved.Service
    return handlers
      .handle(
        "savedPermissions",
        Effect.fn(function* (ctx) {
          return yield* saved.list({ projectID: ctx.query.projectID })
        }),
      )
      .handle(
        "removeSavedPermission",
        Effect.fn(function* (ctx) {
          yield* saved.remove(ctx.params.id)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
