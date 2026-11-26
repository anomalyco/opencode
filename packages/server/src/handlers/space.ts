import { InvalidRequestError } from "@opencode/protocol/errors"
import { Space } from "@opencode/schema/space"
import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { SpaceStore } from "../space-store"

/** `space.*` in the `server.experimental` group. */
const streamNotFound = () =>
  new InvalidRequestError({ message: "No open event stream has this ID", kind: "stream_not_found", field: "stream" })

export const makeSpace = Effect.gen(function* () {
  const store = yield* SpaceStore.Service

  return {
    set: Effect.fn("SpaceHandler.set")(function* (space: Space.Name, key: Space.Key, value: Space.Value) {
      if (new TextEncoder().encode(value).length > Space.MaxValueBytes)
        return yield* new InvalidRequestError({ message: "Value exceeds 1 MiB of UTF-8", field: "value" })
      yield* store.set(space, key, value)
      return HttpApiSchema.NoContent.make()
    }),
    sync: Effect.fn("SpaceHandler.sync")(function* (space: Space.Name, cursor: string | undefined) {
      return yield* store.sync(space, cursor)
    }),
    subscribe: Effect.fn("SpaceHandler.subscribe")(function* (payload: {
      readonly stream: string
      readonly spaces: ReadonlyArray<{ readonly space: Space.Name; readonly cursor: string }>
    }) {
      if (!(yield* store.subscribe(payload.stream, payload.spaces))) return yield* streamNotFound()
      return HttpApiSchema.NoContent.make()
    }),
    unsubscribe: Effect.fn("SpaceHandler.unsubscribe")(function* (payload: {
      readonly stream: string
      readonly spaces: ReadonlyArray<Space.Name>
    }) {
      if (!(yield* store.unsubscribe(payload.stream, payload.spaces))) return yield* streamNotFound()
      return HttpApiSchema.NoContent.make()
    }),
    reset: Effect.fn("SpaceHandler.reset")(function* () {
      yield* store.resetEpoch
      return HttpApiSchema.NoContent.make()
    }),
    remove: Effect.fn("SpaceHandler.remove")(function* (space: Space.Name, key: Space.Key) {
      yield* store.remove(space, key)
      return HttpApiSchema.NoContent.make()
    }),
  }
})
