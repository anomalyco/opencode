import { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import { Session } from "@/session/session"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionMutation } from "@/session/closure/mutation"
import { Effect } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import * as ApiError from "../errors"

/**
 * A `Record` keyed by the public kind rather than a switch, because the key set is
 * `ApiError.SessionClosureError`'s `kind` literal union: adding a sixth kind to the schema without
 * a message here fails to compile. A switch with a default would accept it silently, and a
 * silently-defaulted public message is exactly the leak this table exists to prevent.
 */
const CLOSURE_MESSAGE: Record<ApiError.SessionClosureError["kind"], string> = {
  scope_incomplete: "The Task branch could not be proven completely; cancellation remains incomplete.",
  quiescence_failed: "The Task branch did not reach conversational quiescence.",
  planning_failed: "Closure evidence could not be prepared.",
  record_failed: "Closure evidence could not be recorded or verified.",
  closure_unavailable: "Task branch cancellation is temporarily unavailable.",
}

/**
 * Maps the two expected branch-closure domain failures onto the declared safe 500.
 *
 * A wrong-Location rejection becomes `scope_incomplete` rather than `closure_unavailable`: both are
 * misroutes, but `closure_unavailable` says the driver malfunctioned, and a request aimed at the
 * wrong Location is rejected before any mutation.
 *
 * `mapError` rather than `catchTag`, because the domain failure and the API error share the tag
 * `SessionClosureError`; matching `_tag` against the Location error — the one tag that is
 * unambiguous — keeps the discrimination explicit. Defects are untouched and retain the platform's
 * existing internal-error handling.
 */
export function mapClosure<A, R>(self: Effect.Effect<A, SessionClosure.Failure | SessionClosure.LocationError, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      const kind = error._tag === "SessionClosureLocationError" ? ("scope_incomplete" as const) : error.kind
      return new ApiError.SessionClosureError({ kind, message: CLOSURE_MESSAGE[kind] })
    }),
  )
}

/**
 * Maps a refusal to accept new work onto 409.
 *
 * Both arms are expected conditions rather than faults: admission declined because the session's
 * branch is closing, or a destructive mutation was refused for the same reason. The request
 * conflicts with the session's current state and can succeed once closure settles, which is what
 * 409 means — a 500 would report a defect that did not occur.
 */
/**
 * Rendered as `SessionBusyError` rather than a second 409 type.
 *
 * Session routes already document exactly one error for 409, and OpenAPI carries one schema per
 * status code, so introducing a second would make that response ambiguous. The meaning also fits:
 * the session cannot accept this request right now and will once closure settles. The message
 * carries why it was refused.
 */
function closing(sessions: readonly string[]) {
  return new ApiError.SessionBusyError({
    sessionID: sessions[0] ?? "",
    message: `Task branch cancellation is in progress for ${sessions.join(", ")}; new work cannot be accepted.`,
  })
}

type Admission = SessionClosure.AdmissionRefused | SessionMutation.MutationRefused

/**
 * `instanceof` rather than `catchTag`, because a tag handler cannot discriminate against a free
 * type parameter. Errors this does not recognise stay in the channel so the other mappers compose
 * around it.
 *
 * The result subtracts what was handled with `Exclude` rather than declaring the parameter as
 * `E | Admission`: given that shape TypeScript infers `E` as the whole union, so the handled errors
 * would remain in the caller's declared channel even though this converts them.
 *
 * An admission refusal names the one session it refused; a mutation refusal names every session
 * whose branch it would have touched.
 */
export function mapAdmission<A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, Admission> | ApiError.SessionBusyError, R> {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof SessionClosure.AdmissionRefused) return closing([error.session])
      if (error instanceof SessionMutation.MutationRefused) return closing(error.sessions)
      return error as Exclude<E, Admission>
    }),
  )
}

// Generic in the trailing error for the same reason `mapBusy` is: a seam that can raise a storage
// miss can also raise a refusal, and each mapper must leave the other's errors alone. Every
// existing caller passes exactly `NotFoundError` and still compiles.
export function mapStorageNotFound<A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, StorageNotFoundError> | ApiError.ApiNotFoundError, R> {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof StorageNotFoundError) return ApiError.notFound(error.message)
      return error as Exclude<E, StorageNotFoundError>
    }),
  )
}

/**
 * Maps a rejected operation boundary onto 400.
 *
 * The request named a message or part that cannot serve as the boundary of this operation, so it
 * is malformed rather than conflicting: repeating it produces the same answer. Generic in the
 * trailing error so it composes with the other mappers on the same seam.
 */
export function mapBoundary<A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, Session.BoundaryError> | HttpApiError.BadRequest, R> {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof Session.BoundaryError) return new HttpApiError.BadRequest({})
      return error as Exclude<E, Session.BoundaryError>
    }),
  )
}

// Generic in the trailing error so this composes with `mapAdmission`: a seam that takes admission
// before the Runner accepts work can raise either, and each mapper leaves the other's errors alone.
export function mapBusy<A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, Session.BusyError> | ApiError.SessionBusyError, R> {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof Session.BusyError)
        return new ApiError.SessionBusyError({
          sessionID: error.sessionID,
          message: `Session is busy: ${error.sessionID}`,
        })
      return error as Exclude<E, Session.BusyError>
    }),
  )
}
