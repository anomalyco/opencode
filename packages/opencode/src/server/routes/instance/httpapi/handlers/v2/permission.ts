import { Database } from "@opencode-ai/core/database/database"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PermissionV2 } from "@opencode-ai/core/permission"
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
      "permissions",
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

    return handlers.handle(
      "permissionReply",
      Effect.fn(function* (ctx) {
        const row = yield* db
          .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, ctx.params.sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row)
          return yield* new SessionNotFoundError({
            sessionID: ctx.params.sessionID,
            message: `Session not found: ${ctx.params.sessionID}`,
          })

        yield* Effect.gen(function* () {
          const permission = yield* PermissionV2.Service
          const request = yield* permission.get(ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* missingRequest(ctx.params.requestID)
          yield* permission
            .reply({ requestID: ctx.params.requestID, reply: ctx.payload.reply, message: ctx.payload.message })
            .pipe(Effect.catchTag("PermissionV2.NotFoundError", () => missingRequest(ctx.params.requestID)))
        }).pipe(
          Effect.scoped,
          Effect.provide(
            locations.get({ directory: AbsolutePath.make(row.directory), workspaceID: row.workspaceID ?? undefined }),
          ),
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
  }),
)
