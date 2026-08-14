import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"

export default defineScript({
  run: () =>
    Effect.gen(function* () {
      yield* Effect.never
    }),
})
