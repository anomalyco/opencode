import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

export default defineScript({
  run: ({ tui, ui }) =>
    Effect.gen(function* () {
      yield* tui.close()
      const closed = Exit.isFailure(yield* Effect.exit(ui.state()))
      if (!closed)
        yield* Effect.fail(
          new Error("primary TUI remained connected after tui.close()"),
        )
    }),
})
