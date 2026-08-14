import { defineScript, Llm } from "opencode-drive"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

export default defineScript({
  run: ({ llm }) =>
    Effect.gen(function* () {
      const completed = yield* Deferred.make<void>()
      yield* llm.serve(() =>
        Stream.make(
          Llm.reasoning("thinking", { delay: 0, chunkSize: 2 }),
          Llm.pause(1),
          Llm.text("served response"),
          Llm.finish("length"),
        ).pipe(Stream.onEnd(Deferred.succeed(completed, undefined))),
      )
      yield* Deferred.await(completed)
    }),
})
