import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { PushList } from "@opencode/core/push/list"
import { PushOptions } from "@opencode/core/push/options"
import { ForbiddenError, InvalidRequestError, PushNotFoundError } from "@opencode/protocol/errors"
import type { Push } from "@opencode/schema/push"
import type { Session } from "@opencode/schema/session"

export const makePush = Effect.gen(function* () {
  const list = yield* PushList.Service
  const options = yield* PushOptions.Service

  const requireEnabled = Effect.gen(function* () {
    const current = yield* options.get()
    if (current.enabled) return current
    return yield* new ForbiddenError({ message: "Push notifications are disabled; enable experimental.push" })
  })

  const invalid = (error: PushList.InvalidError) => new InvalidRequestError({ message: error.reason })
  const notFound = (error: PushList.NotFoundError) =>
    new PushNotFoundError({ deviceID: error.id, message: error.message })

  return {
    get: Effect.fn("PushHandler.get")(function* () {
      const current = yield* requireEnabled
      return { data: { ...(yield* list.info()), relays: current.relays } }
    }),
    register: Effect.fn("PushHandler.register")(function* (id: Push.DeviceID, payload: Push.Register) {
      const current = yield* requireEnabled
      return { data: yield* list.register(id, payload, current.relays).pipe(Effect.mapError(invalid)) }
    }),
    remove: Effect.fn("PushHandler.remove")(function* (id: Push.DeviceID) {
      yield* requireEnabled
      yield* list.remove(id)
      return HttpApiSchema.NoContent.make()
    }),
    update: Effect.fn("PushHandler.update")(function* (id: Push.DeviceID, payload: Push.DevicePatch) {
      yield* requireEnabled
      return { data: yield* list.update(id, payload).pipe(Effect.mapError(notFound)) }
    }),
    setDeviceBell: Effect.fn("PushHandler.setDeviceBell")(function* (
      id: Push.DeviceID,
      sessionID: Session.ID,
      bell: Push.Bell,
    ) {
      yield* requireEnabled
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
      yield* requireEnabled
      yield* list.removeDeviceBell(id, sessionID).pipe(Effect.mapError(notFound))
      return HttpApiSchema.NoContent.make()
    }),
    setSessionBell: Effect.fn("PushHandler.setSessionBell")(function* (sessionID: Session.ID, bell: Push.Bell) {
      yield* requireEnabled
      return { data: yield* list.setSessionBell(sessionID, bell).pipe(Effect.mapError(invalid)) }
    }),
    removeSessionBell: Effect.fn("PushHandler.removeSessionBell")(function* (sessionID: Session.ID) {
      yield* requireEnabled
      yield* list.removeSessionBell(sessionID)
      return HttpApiSchema.NoContent.make()
    }),
    setSettings: Effect.fn("PushHandler.setSettings")(function* (settings: Push.Settings) {
      yield* requireEnabled
      return { data: yield* list.setSettings(settings).pipe(Effect.mapError(invalid)) }
    }),
  }
})
