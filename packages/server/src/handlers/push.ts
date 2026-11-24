import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { PushList } from "@opencode/core/push/list"
import { PushOptions } from "@opencode/core/push/options"
import { InvalidRequestError, PushNotFoundError } from "@opencode/protocol/errors"
import type { Push } from "@opencode/schema/push"
import type { Session } from "@opencode/schema/session"

export const makePush = Effect.gen(function* () {
  const list = yield* PushList.Service
  const options = yield* PushOptions.make

  const requireEnabled = Effect.gen(function* () {
    const current = yield* options
    if (current.enabled) return current
    return yield* new PushNotFoundError({ message: "Push notifications are off on this server." })
  })

  const invalid = (error: PushList.InvalidError) => new InvalidRequestError({ message: error.reason })
  const notFound = (error: PushList.NotFoundError) => new PushNotFoundError({ message: error.message })

  return {
    get: Effect.fn("PushHandler.get")(function* () {
      yield* requireEnabled
      return yield* list.info()
    }),
    register: Effect.fn("PushHandler.register")(function* (id: Push.DeviceID, payload: Push.Register) {
      const current = yield* requireEnabled
      return yield* list.register(id, payload, current.relays).pipe(Effect.mapError(invalid))
    }),
    remove: Effect.fn("PushHandler.remove")(function* (id: Push.DeviceID) {
      yield* requireEnabled
      yield* list.remove(id)
      return HttpApiSchema.NoContent.make()
    }),
    update: Effect.fn("PushHandler.update")(function* (id: Push.DeviceID, payload: Push.DevicePatch) {
      yield* requireEnabled
      return yield* list.pause(id, payload.paused).pipe(Effect.mapError(notFound))
    }),
    setDeviceBell: Effect.fn("PushHandler.setDeviceBell")(function* (
      id: Push.DeviceID,
      sessionID: Session.ID,
      bell: Push.Bell,
    ) {
      yield* requireEnabled
      return yield* list.setDeviceBell(id, sessionID, bell).pipe(
        Effect.catchTags({
          "PushList.InvalidError": (error) => Effect.fail(invalid(error)),
          "PushList.NotFoundError": (error) => Effect.fail(notFound(error)),
        }),
      )
    }),
    removeDeviceBell: Effect.fn("PushHandler.removeDeviceBell")(function* (id: Push.DeviceID, sessionID: Session.ID) {
      yield* requireEnabled
      yield* list.removeDeviceBell(id, sessionID).pipe(Effect.mapError(notFound))
      return HttpApiSchema.NoContent.make()
    }),
    setSessionBell: Effect.fn("PushHandler.setSessionBell")(function* (sessionID: Session.ID, bell: Push.Bell) {
      yield* requireEnabled
      return yield* list.setSessionBell(sessionID, bell).pipe(Effect.mapError(invalid))
    }),
    removeSessionBell: Effect.fn("PushHandler.removeSessionBell")(function* (sessionID: Session.ID) {
      yield* requireEnabled
      yield* list.removeSessionBell(sessionID)
      return HttpApiSchema.NoContent.make()
    }),
    settings: Effect.fn("PushHandler.settings")(function* () {
      yield* requireEnabled
      return yield* list.settings()
    }),
    setSettings: Effect.fn("PushHandler.setSettings")(function* (settings: Push.Settings) {
      yield* requireEnabled
      return yield* list.setSettings(settings).pipe(Effect.mapError(invalid))
    }),
  }
})
