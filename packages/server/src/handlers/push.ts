import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { PushList } from "@opencode/core/push/list"
import { InvalidRequestError, PushDeviceNotFoundError } from "@opencode/protocol/errors"
import type { Push } from "@opencode/schema/push"
import type { Session } from "@opencode/schema/session"

export const makePush = Effect.gen(function* () {
  const list = yield* PushList.Service

  const invalid = (error: PushList.InvalidError) => new InvalidRequestError({ message: error.reason })
  const notFound = (error: PushList.NotFoundError) =>
    new PushDeviceNotFoundError({ deviceID: error.id, message: error.message })

  return {
    get: Effect.fn("PushHandler.get")(function* () {
      return { data: yield* list.info() }
    }),
    register: Effect.fn("PushHandler.register")(function* (id: Push.DeviceID, payload: Push.Register) {
      return { data: yield* list.register(id, payload).pipe(Effect.mapError(invalid)) }
    }),
    remove: Effect.fn("PushHandler.remove")(function* (id: Push.DeviceID) {
      yield* list.remove(id)
      return HttpApiSchema.NoContent.make()
    }),
    update: Effect.fn("PushHandler.update")(function* (id: Push.DeviceID, payload: Push.DevicePatch) {
      return { data: yield* list.update(id, payload).pipe(Effect.mapError(notFound)) }
    }),
    setDeviceBell: Effect.fn("PushHandler.setDeviceBell")(function* (
      id: Push.DeviceID,
      sessionID: Session.ID,
      bell: Push.Bell,
    ) {
      return {
        data: yield* list.setDeviceBell(id, sessionID, bell).pipe(
          Effect.catchTags({
            "PushList.InvalidError": (error) => Effect.fail(invalid(error)),
            "PushList.NotFoundError": (error) => Effect.fail(notFound(error)),
          }),
        ),
      }
    }),
    removeDeviceBell: Effect.fn("PushHandler.removeDeviceBell")(function* (id: Push.DeviceID, sessionID: Session.ID) {
      yield* list.removeDeviceBell(id, sessionID).pipe(Effect.mapError(notFound))
      return HttpApiSchema.NoContent.make()
    }),
    setSessionBell: Effect.fn("PushHandler.setSessionBell")(function* (sessionID: Session.ID, bell: Push.Bell) {
      return { data: yield* list.setSessionBell(sessionID, bell).pipe(Effect.mapError(invalid)) }
    }),
    removeSessionBell: Effect.fn("PushHandler.removeSessionBell")(function* (sessionID: Session.ID) {
      yield* list.removeSessionBell(sessionID)
      return HttpApiSchema.NoContent.make()
    }),
    setSettings: Effect.fn("PushHandler.setSettings")(function* (settings: Push.Settings) {
      return { data: yield* list.setSettings(settings).pipe(Effect.mapError(invalid)) }
    }),
  }
})
