import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"

export default defineScript({
  run: () =>
    Effect.gen(function* () {
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response("leaked script server"),
      })
      yield* Effect.fail(new Error("script crashed"))
    }),
})
