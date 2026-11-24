import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { PushList } from "@opencode/core/push/list"
import { PushOptions } from "@opencode/core/push/options"
import { InvalidRequestError, PushNotFoundError } from "@opencode/protocol/errors"
import type { Push } from "@opencode/schema/push"

export const makePush = Effect.gen(function* () {
  const list = yield* PushList.Service
  const options = yield* PushOptions.make

  const requireEnabled = Effect.gen(function* () {
    const current = yield* options
    if (current.enabled) return current
    return yield* new PushNotFoundError({ message: "Push notifications are off on this server." })
  })

  const invalid = (error: PushList.InvalidError) => new InvalidRequestError({ message: error.reason })

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
  }
})
