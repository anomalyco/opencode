import { Backup } from "@/backup"
import * as InstanceState from "@/effect/instance-state"
import { NotFoundError } from "@/storage/storage"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ImportPayload, SessionPayload } from "../groups/backup"

export const backupHandlers = HttpApiBuilder.group(InstanceHttpApi, "backup", (handlers) =>
  Effect.gen(function* () {
    const backup = yield* Backup.Service

    const list = Effect.fn("BackupHttpApi.list")(function* () {
      return yield* backup.list((yield* InstanceState.context).project.id)
    })

    const exportSession = Effect.fn("BackupHttpApi.export")(function* (ctx: { payload: typeof SessionPayload.Type }) {
      return yield* backup
        .exportSession(ctx.payload.sessionID, (yield* InstanceState.context).project.id)
        .pipe(
          Effect.catchIf(NotFoundError.isInstance, () => Effect.fail(new HttpApiError.NotFound({}))),
          Effect.mapError(() => new HttpApiError.BadRequest({})),
        )
    })

    const importSession = Effect.fn("BackupHttpApi.import")(function* (ctx: { payload: typeof ImportPayload.Type }) {
      return {
        sessionID: yield* backup
          .importSession(
            structuredClone(ctx.payload.payload) as Backup.Payload,
            (yield* InstanceState.context).project.id,
          )
          .pipe(Effect.mapError(() => new HttpApiError.BadRequest({}))),
      }
    })

    return handlers.handle("list", list).handle("export", exportSession).handle("import", importSession)
  }),
)
