import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import type { Session } from "@/session/session"
import { Effect } from "effect"
import * as ApiError from "../errors"

type DuplicateID = InstanceType<typeof Session.DuplicateIDError>

export function mapStorageNotFound<A, R>(self: Effect.Effect<A, StorageNotFoundError, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.notFound(error.message)))
}

export function mapBusy<A, R>(self: Effect.Effect<A, Session.BusyError, R>) {
  return self.pipe(
    Effect.catchTag("SessionBusyError", (error) =>
      Effect.fail(
        new ApiError.SessionBusyError({
          sessionID: error.sessionID,
          message: `Session is busy: ${error.sessionID}`,
        }),
      ),
    ),
  )
}

export function mapDuplicateID<A, R>(self: Effect.Effect<A, DuplicateID, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.duplicateID(error.data.id)))
}
