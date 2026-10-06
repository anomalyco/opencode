import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import type { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { Effect } from "effect"
import * as ApiError from "../errors"

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

// SessionPrompt dies with Provider.ModelNotFoundError; surface it as the declared 404
// instead of letting the defect fall through to a generic UnknownError.
export function mapModelNotFound<A, E, R>(self: Effect.Effect<A, E, R>) {
  return self.pipe(
    Effect.catchDefect((defect) =>
      Provider.ModelNotFoundError.isInstance(defect)
        ? Effect.fail(ApiError.notFound(defect.message))
        : Effect.die(defect),
    ),
  )
}
