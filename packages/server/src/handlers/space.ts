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
    write: Effect.fn("SpaceHandler.write")(function* (space: Space.Name, changes: ReadonlyArray<Space.Change>) {
      const encoder = new TextEncoder()
      const bytes = changes.reduce(
        (total, change) => total + (change.value === null ? 0 : encoder.encode(change.value).length),
        0,
      )
      if (bytes > Space.MaxValueBytes)
        return yield* new InvalidRequestError({ message: "Values exceed 1 MiB of UTF-8 in total", field: "changes" })
      return yield* store.write(space, changes)
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
  }
})
